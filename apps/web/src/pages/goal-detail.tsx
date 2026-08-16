import type { DodItem } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pause, Play, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { useConfirm } from "../components/ui/confirm";
import { GoalControls, GoalSharedState, Rail } from "./goal-detail-parts";
import { InlineError, SkeletonRows } from "../components/ui/feedback";
import { Input } from "../components/ui/form";
import { Panel, PanelHeader, PanelTitle, Well } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { StatCard } from "../components/ui/stat";
import { Duration, Time } from "../components/ui/time";

let nextDraftId = 0;

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
    return (
      <Panel>
        <SkeletonRows rows={5} />
      </Panel>
    );
  }

  const data = goal.data;
  const checked = data.definitionOfDone.filter((item) => item.done).length;
  const total = data.definitionOfDone.length;

  return (
    <div className="space-y-4">
      <Panel className="p-5">
        <h2 className="text-[15px] font-semibold text-ink">{data.title}</h2>
        <p className="mt-2 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-muted">
          {data.spec}
        </p>

        {/*
          The rails. A goal loops on its own, so the three things that can stop
          it — spend, wall-clock, and repeated no-progress iterations — are the
          operator's whole safety net and were not rendered anywhere.
        */}
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-edge pt-4 text-xs">
          <Rail label="Spend cap">
            {data.spendCapUsd === null ? (
              <span className="text-gate">none</span>
            ) : (
              `$${data.spendCapUsd.toFixed(2)}`
            )}
          </Rail>
          <Rail label="Time cap">
            {data.maxDurationMinutes === null ? (
              <span className="text-gate">none</span>
            ) : (
              `${data.maxDurationMinutes} min`
            )}
          </Rail>
          <Rail label="Stuck after">{data.stuckThreshold} iterations</Rail>
          <Rail label="Runner">{data.runnerPreference}</Rail>
          {/* A goal is the one thing here that runs for hours unattended, so
              "since when" and "for how long" are the first two questions. */}
          <Rail label="Started">
            {data.startedAt ? <Time iso={data.startedAt} /> : <span className="text-ink-faint">not yet</span>}
          </Rail>
          {data.startedAt ? (
            <Rail label="Running for">
              <Duration
                startedAt={data.startedAt}
                endedAt={data.status === "active" ? null : data.updatedAt}
                className="text-xs"
              />
            </Rail>
          ) : null}
          <Rail label="Last change">
            <Time iso={data.updatedAt} />
          </Rail>
        </dl>
      </Panel>

      {!data.dodApproved ? (
        <Panel>
          <PanelHeader className="border-b border-edge">
            <PanelTitle accent="amber">Definition of done</PanelTitle>
            <StatusPill tone="gate">approval required</StatusPill>
          </PanelHeader>

          <div className="space-y-2 p-4">
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

          <div className="flex justify-end border-t border-edge px-4 py-3.5">
            <Button
              variant="solid"
              disabled={draft.filter((item) => item.text.trim()).length === 0 || approve.isPending}
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
                  onConfirm: () => approve.mutate(draft.filter((item) => item.text.trim())),
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
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard
              label="Spend"
              accent="violet"
              value={`$${data.spendUsd.toFixed(2)}`}
              suffix={data.spendCapUsd !== null ? `of $${data.spendCapUsd.toFixed(2)}` : "no cap"}
              footer={
                data.spendCapUsd === null
                  ? "No spend limit configured."
                  : `${data.iterations} iterations so far`
              }
              meter={
                data.spendCapUsd === null
                  ? undefined
                  : [
                      {
                        label: "Spent",
                        // Cents drive the bar so a sub-dollar spend still has
                        // width; the legend prints dollars.
                        value: Math.round(data.spendUsd * 100),
                        display: `$${data.spendUsd.toFixed(2)}`,
                        accent: "violet",
                      },
                      {
                        label: "Remaining",
                        value: Math.max(Math.round((data.spendCapUsd - data.spendUsd) * 100), 0),
                        display: `$${Math.max(data.spendCapUsd - data.spendUsd, 0).toFixed(2)}`,
                        accent: "sky",
                      },
                    ]
              }
            />
            <StatCard
              label="Checklist"
              accent="emerald"
              value={checked}
              suffix={`of ${total} done`}
              footer={
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
              }
              meter={[
                { label: "Done", value: checked, accent: "emerald" },
                { label: "Open", value: total - checked, accent: "amber" },
              ]}
            />
          </div>

          <Panel>
            <PanelHeader className="border-b border-edge">
              <PanelTitle accent="emerald">Definition of done</PanelTitle>
            </PanelHeader>
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
                    className={`text-[13px] ${item.done ? "text-ink-faint line-through" : "text-ink"}`}
                  >
                    {item.text}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <GoalSharedState projectId={props.projectId} goalId={props.goalId} />

          <Panel>
            <PanelHeader className="border-b border-edge">
              <PanelTitle accent="sky">Progress log</PanelTitle>
            </PanelHeader>
            <div className="p-4">
              <Well className="max-h-96 overflow-auto p-0">
                <pre className="machine px-3.5 py-3 text-xs leading-relaxed whitespace-pre-wrap text-ink-muted">
                  {data.progressLog || "No progress recorded."}
                </pre>
              </Well>
            </div>
          </Panel>

          {data.stoppedReason ? (
            <InlineError>Goal stopped: {data.stoppedReason}</InlineError>
          ) : null}
        </>
      )}
    </div>
  );
}
