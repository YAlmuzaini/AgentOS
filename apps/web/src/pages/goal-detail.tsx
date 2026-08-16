import type { DodItem } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Clock3,
  FileText,
  Fingerprint,
  ListChecks,
  Play,
  Plus,
  Repeat,
  Server,
  Target,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { useConfirm } from "../components/ui/confirm";
import { EmptyState, InlineError, Skeleton } from "../components/ui/feedback";
import { Input } from "../components/ui/form";
import { IconTile, toneFor } from "../components/ui/icon-tile";
import { Meta, MetaRow } from "../components/ui/meta";
import { Panel, PanelHeader, PanelTitle, Well } from "../components/ui/panel";
import { CountChip, StatusPill } from "../components/ui/pill";
import { Meter } from "../components/ui/stat";
import { Duration, Time } from "../components/ui/time";
import { reflow } from "../lib/prose";
import {
  errorText,
  GoalControls,
  GoalRails,
  GoalSharedState,
  GoalStopped,
  goalState,
} from "./goal-detail-parts";

let nextDraftId = 0;

/**
 * One goal, on one screen: what it is, how far along it is, and how close it is
 * to the rails that stop it.
 *
 * The shape is the agent detail's — a main column with a 320px rail beside it —
 * but the rail arrives a breakpoint later, because this screen sits inside the
 * two-pane list rather than owning the whole sheet. Splitting at `xl` left the
 * main column around 360px wide, which is narrower than the checklist it is
 * meant to be showing.
 */
export function GoalDetail(props: {
  projectId: string;
  goalId: string;
  onChanged: () => void;
}): React.JSX.Element {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const goal = useQuery({
    queryKey: ["goal", props.projectId, props.goalId],
    queryFn: () => api.goal(props.projectId, props.goalId),
    refetchInterval: 4000,
  });

  const [draft, setDraft] = useState<DodItem[]>([]);

  // Seed the editable draft once, from whatever checklist the API returned
  // (the heuristic first pass, or an empty list to hand-author from scratch).
  useEffect(() => {
    if (goal.data && !goal.data.dodApproved) {
      setDraft(goal.data.definitionOfDone);
    }
  }, [goal.data?.id, goal.data?.dodApproved]);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ["goal", props.projectId, props.goalId] });
    props.onChanged();
  };

  const approve = useMutation({
    mutationFn: (items: DodItem[]) =>
      api.approveGoalDod(props.projectId, props.goalId, { definitionOfDone: items }),
    onSuccess: invalidate,
  });
  const pause = useMutation({
    mutationFn: () => api.pauseGoal(props.projectId, props.goalId),
    onSuccess: invalidate,
  });
  const resume = useMutation({
    mutationFn: () => api.resumeGoal(props.projectId, props.goalId),
    onSuccess: invalidate,
  });

  if (!goal.data) {
    return goal.isError ? (
      <Panel className="p-4">
        <InlineError>{errorText(goal.error, "Unable to load this goal.")}</InlineError>
      </Panel>
    ) : (
      <GoalDetailSkeleton />
    );
  }

  const data = goal.data;
  const state = goalState(data);
  const checked = data.definitionOfDone.filter((item) => item.done).length;
  const total = data.definitionOfDone.length;
  const usable = draft.filter((item) => item.text.trim());
  // Pause and resume are the same control in two states, so one error line
  // under the header covers both rather than each growing its own.
  const controlError = pause.error ?? resume.error;

  return (
    <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_320px] 2xl:items-start">
      {/* Identity spans both columns, so the rail below it starts level with
          the checklist rather than a panel further down. */}
      <div className="min-w-0 space-y-4 2xl:col-span-2">
        <Panel>
          <div className="flex flex-wrap items-start gap-3 border-b border-edge p-4">
            {/* The same tile and tint the row in the list wore, so opening a
                goal reads as opening that row rather than as landing on an
                unrelated screen. */}
            <IconTile tone={toneFor(data.id)} size="lg">
              <Target />
            </IconTile>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-start gap-2">
                <h2
                  className="min-w-0 line-clamp-2 text-[15px] leading-snug font-semibold text-ink"
                  title={data.title}
                >
                  {data.title}
                </h2>
                <StatusPill tone={state.tone} dot pulse={state.pulse} title={state.title}>
                  {state.label}
                </StatusPill>
              </div>
              <MetaRow className="mt-1.5">
                <Meta icon={<Fingerprint />} machine title={data.id}>
                  {data.id.slice(0, 8)}
                </Meta>
                <Meta icon={<Server />}>{data.runnerPreference} runner</Meta>
                <Meta icon={<Repeat />}>
                  {data.iterations} {data.iterations === 1 ? "iteration" : "iterations"}
                </Meta>
                {/* A goal is the one thing here that runs for hours unattended,
                    so "since when" and "for how long" are the first two
                    questions. The duration ticks while it is still running. */}
                <Meta icon={<Play />}>
                  {data.startedAt ? (
                    <>
                      started <Time iso={data.startedAt} />
                    </>
                  ) : (
                    "not started"
                  )}
                </Meta>
                {data.startedAt ? (
                  <Meta icon={<Clock3 />}>
                    ran{" "}
                    <Duration
                      startedAt={data.startedAt}
                      endedAt={data.status === "active" ? null : data.updatedAt}
                    />
                  </Meta>
                ) : null}
                <Meta icon={<Clock3 />}>
                  changed <Time iso={data.updatedAt} />
                </Meta>
              </MetaRow>
            </div>
            <GoalControls
              data={data}
              pause={pause}
              resume={resume}
              onDelete={{
                run: () => api.deleteGoal(props.projectId, props.goalId),
                projectId: props.projectId,
                title: data.title,
              }}
            />
          </div>

          <div className="space-y-2 p-4">
            <PanelTitle icon={<FileText />}>Specification</PanelTitle>
            <Well className="text-[13px] leading-relaxed break-words whitespace-pre-wrap text-ink">
              {reflow(data.spec)}
            </Well>
          </div>
        </Panel>

        {controlError ? (
          <InlineError>{errorText(controlError, "Unable to update the goal.")}</InlineError>
        ) : null}

        {/* Why the goal is not running any more, directly under the thing it is
            about. It used to sit below the progress log, which is to say it was
            the last line read on a screen it explains. */}
        {data.stoppedReason ? <GoalStopped reason={data.stoppedReason} /> : null}
      </div>

      {/*
        The safety story, in the rail, on both sides of approval — the caps are
        what the operator is agreeing to when they approve, so they have to be
        readable while the checklist is being read. Placed before the main
        column in the DOM so that when the two panes stack it lands directly
        under the header instead of below the progress log.
      */}
      <GoalRails goal={data} className="2xl:col-start-2 2xl:row-start-2" />

      <div className="min-w-0 space-y-4 2xl:col-start-1 2xl:row-start-2">
        {!data.dodApproved ? (
          <Panel>
            <PanelHeader className="border-b border-edge">
              <PanelTitle accent="amber">Definition of done</PanelTitle>
              <StatusPill
                tone="gate"
                title="An agent cannot mark this done. Only you can close it."
              >
                approval required
              </StatusPill>
            </PanelHeader>

            <div className="space-y-2 p-4">
              <p className="text-[13px] leading-relaxed text-ink-muted">
                Nothing runs until you approve this list. Each line should be something an agent can
                finish and you can check.
              </p>
              {draft.map((item, index) => (
                <div key={item.id} className="flex items-center gap-2">
                  <Input
                    value={item.text}
                    placeholder="Enter a measurable completion criterion"
                    onChange={(event) => {
                      const next = [...draft];
                      next[index] = { ...item, text: event.target.value };
                      setDraft(next);
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove item"
                    title="Remove item"
                    onClick={() => setDraft(draft.filter((_, i) => i !== index))}
                  >
                    <X />
                  </Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setDraft([...draft, { id: `draft-${nextDraftId++}`, text: "", done: false }])
                }
              >
                <Plus />
                Add item
              </Button>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-edge px-4 py-3.5">
              {approve.isError ? (
                <InlineError className="min-w-0 flex-1">
                  {errorText(approve.error, "The checklist was not approved.")}
                </InlineError>
              ) : null}
              <span className="tnum text-xs text-ink-faint">
                {usable.length} {usable.length === 1 ? "criterion" : "criteria"}
              </span>
              <Button
                variant="solid"
                disabled={usable.length === 0 || approve.isPending}
                onClick={() =>
                  confirm({
                    kind: "spend",
                    title: `Approve and start “${data.title}”?`,
                    body: (
                      <>
                        This starts the goal and dispatches agents until the checklist is complete or
                        an operating limit is reached.{" "}
                        {data.spendCapUsd === null
                          ? "This goal has no spend limit."
                          : `The goal will stop at $${data.spendCapUsd.toFixed(2)}.`}
                      </>
                    ),
                    confirmLabel: "Approve and start",
                    onConfirm: () => approve.mutate(usable),
                  })
                }
              >
                <Check />
                {approve.isPending ? "Approving…" : "Approve and start"}
              </Button>
            </div>
          </Panel>
        ) : (
          <>
            {/*
              The checklist is the progress. It gets the one large number on the
              screen and the meter under it, because "how far along is it" is
              half of what an operator opens this goal to find out.
            */}
            <Panel>
              <PanelHeader className="border-b border-edge">
                <PanelTitle accent="emerald">Definition of done</PanelTitle>
                <CountChip>
                  {checked}/{total}
                </CountChip>
              </PanelHeader>

              {total === 0 ? (
                <EmptyState
                  icon={<ListChecks />}
                  title="No completion criteria"
                  hint="This approved goal does not have any completion criteria."
                />
              ) : (
                <>
                  <div className="space-y-3 border-b border-edge p-4">
                    <div className="flex items-baseline gap-1.5">
                      <span className="tnum text-[28px] leading-none font-semibold tracking-tight text-ink">
                        {checked}
                      </span>
                      <span className="tnum text-[13px] text-ink-faint">of {total} checked off</span>
                    </div>
                    <Meter
                      segments={[
                        { label: "Done", value: checked, accent: "emerald" },
                        { label: "Open", value: total - checked, accent: "amber" },
                      ]}
                    />
                  </div>
                  <ul className="divide-y divide-edge">
                    {data.definitionOfDone.map((item) => (
                      <li key={item.id} className="flex items-start gap-2.5 px-4 py-2.5">
                        <span
                          aria-hidden
                          className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border ${
                            item.done
                              ? "border-live bg-live text-on-solid"
                              : "border-edge-strong bg-panel"
                          }`}
                        >
                          {item.done ? <Check className="size-3" strokeWidth={3} /> : null}
                        </span>
                        <span
                          className={`min-w-0 text-[13px] break-words ${
                            item.done ? "text-ink-faint line-through" : "text-ink"
                          }`}
                        >
                          {item.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Panel>

            <GoalSharedState projectId={props.projectId} goalId={props.goalId} />

            <Panel>
              <PanelHeader className="border-b border-edge">
                <PanelTitle accent="sky">Progress log</PanelTitle>
              </PanelHeader>
              <div className="p-4">
                {data.progressLog ? (
                  <Well className="max-h-96 overflow-auto p-0">
                    <pre className="machine px-3.5 py-3 text-xs leading-relaxed whitespace-pre-wrap text-ink-muted">
                      {data.progressLog}
                    </pre>
                  </Well>
                ) : (
                  <Well>
                    <p className="text-[13px] text-ink-faint">
                      No progress recorded. The orchestrator writes here on every iteration.
                    </p>
                  </Well>
                )}
              </div>
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}

/** Shaped like the screen it stands in for: header, checklist, rail. */
function GoalDetailSkeleton(): React.JSX.Element {
  return (
    <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_320px] 2xl:items-start">
      <Panel className="space-y-4 p-4 2xl:col-span-2">
        <div className="flex items-start gap-3">
          <Skeleton className="size-11 shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
        <Skeleton className="h-16" />
      </Panel>
      <Panel className="h-fit space-y-3 p-4 2xl:col-start-2 2xl:row-start-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </Panel>
      <Panel className="space-y-3 p-4 2xl:col-start-1 2xl:row-start-2">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-1.5" />
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
      </Panel>
    </div>
  );
}
