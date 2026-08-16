import type { GoalDto } from "@agentos/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DollarSign, ListChecks, Plus, Repeat, Target } from "lucide-react";
import { useSearch } from "@tanstack/react-router";
import { useUrlSelection } from "../hooks/use-url-selection";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { EmptyState, InlineError, Skeleton } from "../components/ui/feedback";
import { CheckboxField, Field, FormActions, Input, Textarea } from "../components/ui/form";
import { IconTile, toneFor } from "../components/ui/icon-tile";
import { Meta, MetaRow } from "../components/ui/meta";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { CountChip, StatusPill } from "../components/ui/pill";
import { useProjectGate } from "../hooks/use-project";
import { GoalDetail } from "./goal-detail";
import { errorText, goalState } from "./goal-detail-parts";
import { NoProject, ProjectPending } from "./project-states";
import { Time } from "../components/ui/time";

export function GoalsPage(): React.JSX.Element {
  const { project, pending, absent } = useProjectGate();
  const queryClient = useQueryClient();
  const projectId = project?.id;
  // The URL is the selection; a click overrides it until the URL moves again.
  const { id: idFromUrl } = useSearch({ strict: false }) as { id?: string };
  const [selected, setSelected] = useUrlSelection(idFromUrl);
  const [creating, setCreating] = useState(false);

  const goals = useQuery({
    queryKey: ["goals", projectId],
    queryFn: () => api.goals(projectId!),
    enabled: Boolean(projectId),
    refetchInterval: 5000,
  });

  const create = useMutation({
    mutationFn: (body: Parameters<typeof api.createGoal>[1]) => api.createGoal(projectId!, body),
    onSuccess: (goal: GoalDto) => {
      void queryClient.invalidateQueries({ queryKey: ["goals", projectId] });
      setSelected(goal.id);
      setCreating(false);
    },
  });

  if (absent) {
    return <NoProject />;
  }
  if (pending || !project) {
    return <ProjectPending />;
  }

  const list = goals.data ?? [];
  const awaiting = list.filter((goal) => !goal.dodApproved).length;

  return (
    <Page fill>
      <PageHeader
        icon={<Target />}
        title="Goals"
        meta={list.length > 0 ? <CountChip>{list.length}</CountChip> : undefined}
        actions={
          <>
            {awaiting > 0 ? (
              <StatusPill
                tone="gate"
                dot
                title="These goals cannot start until you approve their definition of done."
              >
                {awaiting} awaiting approval
              </StatusPill>
            ) : null}
            {/* Deliberately not the solid button. The one near-black surface on
                this screen belongs to "Approve and start" — the action only the
                operator can take, and the only one that spends money. */}
            <Button onClick={() => setCreating(true)}>
              <Plus />
              New goal
            </Button>
          </>
        }
      />

      <div className="grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[320px_1fr]">
        {/* The list scrolls inside its own panel: a goal list grows without a
            ceiling, and a list that grows the page takes the detail pane it is
            meant to be driving off the bottom of the screen. */}
        <Panel className="h-fit overflow-hidden lg:flex lg:h-auto lg:min-h-0 lg:flex-col">
          {goals.isLoading ? (
            <GoalRowSkeleton />
          ) : goals.isError ? (
            <div className="p-4">
              <InlineError>{errorText(goals.error, "Unable to load goals.")}</InlineError>
            </div>
          ) : list.length === 0 ? (
            <EmptyState
              icon={<Target />}
              title="No goals yet"
              hint="Create a goal to run agents against an approved completion checklist and operating limits."
              action={
                <Button variant="solid" onClick={() => setCreating(true)}>
                  <Plus />
                  New goal
                </Button>
              }
            />
          ) : (
            <ul className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              {list.map((goal) => (
                <li key={goal.id} className="border-b border-edge last:border-0">
                  <GoalRow
                    goal={goal}
                    selected={selected === goal.id}
                    onOpen={() => setSelected(goal.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="min-w-0 lg:min-h-0 lg:overflow-y-auto">
          {selected ? (
            <GoalDetail
              projectId={project.id}
              goalId={selected}
              onChanged={() => queryClient.invalidateQueries({ queryKey: ["goals", projectId] })}
            />
          ) : (
            <Panel className="h-full">
              <EmptyState
                icon={<ListChecks />}
                title="Select a goal"
                hint="Select a goal to review its checklist, spend, progress, and operating limits."
              />
            </Panel>
          )}
        </div>
      </div>

      <CreateGoalDialog
        open={creating}
        onOpenChange={setCreating}
        pending={create.isPending}
        error={create.isError ? errorText(create.error, "The goal was not created.") : null}
        // `mutateAsync` so the form can wait, and so a rejection reaches it —
        // that is what stops the panel clearing input the server refused.
        onCreate={(body) => create.mutateAsync(body).then(() => undefined)}
      />
    </Page>
  );
}

/**
 * One goal in the list, carrying enough state that the operator does not have
 * to open it to know where it stands.
 *
 * The row used to be a title, a spend line, and a timestamp — so "which of
 * these fourteen is parked on me" and "which one is nearly finished" both cost
 * a click each. Status, the checklist ratio, and spend against cap all live
 * here now, which is the whole point of a two-pane screen.
 */
function GoalRow({
  goal,
  selected,
  onOpen,
}: {
  goal: GoalDto;
  selected: boolean;
  onOpen: () => void;
}): React.JSX.Element {
  const state = goalState(goal);
  const checked = goal.definitionOfDone.filter((item) => item.done).length;
  const total = goal.definitionOfDone.length;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={selected}
      className="flex w-full items-start gap-2.5 px-3 py-3 text-left transition-colors hover:bg-sunken/70 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-solid aria-[current=true]:bg-sunken"
    >
      <IconTile tone={toneFor(goal.id)} size="sm">
        <Target />
      </IconTile>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          {/* Two lines, then a clamp. A goal title runs to 300 characters and
              this column is 320px wide. */}
          <span
            className="line-clamp-2 text-[13px] leading-snug font-medium text-ink"
            title={goal.title}
          >
            {goal.title}
          </span>
          <StatusPill tone={state.tone} dot pulse={state.pulse} title={state.title}>
            {state.label}
          </StatusPill>
        </div>
        <MetaRow className="mt-1.5">
          <Meta icon={<DollarSign />} machine>
            ${goal.spendUsd.toFixed(2)} of{" "}
            {goal.spendCapUsd !== null ? `$${goal.spendCapUsd.toFixed(2)}` : "no cap"}
          </Meta>
          {/* The ratio is the progress, so it belongs where the operator is
              choosing which goal to open. An unapproved goal has none yet. */}
          {goal.dodApproved && total > 0 ? (
            <Meta icon={<ListChecks />} className="tnum">
              {checked}/{total} done
            </Meta>
          ) : null}
          <Meta icon={<Repeat />} className="tnum">
            {goal.iterations} {goal.iterations === 1 ? "iteration" : "iterations"}
          </Meta>
          <Time iso={goal.updatedAt} className="text-ink-faint" />
        </MetaRow>
      </div>
    </button>
  );
}

/** Shaped like the rows it stands in for: tile, title, two lines of meta. */
function GoalRowSkeleton(): React.JSX.Element {
  return (
    <div>
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex items-start gap-2.5 border-b border-edge p-3 last:border-0">
          <Skeleton className="size-7 shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function CreateGoalDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  /** What the server said when it refused the last attempt. */
  error: string | null;
  onCreate: (body: {
    title: string;
    spec: string;
    spendCapUsd: number | null;
    acknowledgeNoSpendCap: boolean;
    maxDurationMinutes: number | null;
  }) => void | Promise<void>;
}): React.JSX.Element {
  const [title, setTitle] = useState("");
  const [spec, setSpec] = useState("");
  const [spendCapUsd, setSpendCapUsd] = useState("");
  const [noSpendCap, setNoSpendCap] = useState(false);
  const [maxDurationMinutes, setMaxDurationMinutes] = useState("");

  const blocked = !title || !spec || (!noSpendCap && !spendCapUsd);

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content className="rise fixed top-1/2 left-1/2 z-50 max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-panel border border-edge bg-panel shadow-pop outline-none">
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (blocked) return;
              try {
                // Awaited, so a rejected create leaves the spec the operator
                // just wrote exactly where it is. Clearing on submit destroyed
                // it, and letting the rejection escape this handler turned a
                // refusal the operator should read into an unhandled promise.
                await props.onCreate({
                  title,
                  spec,
                  spendCapUsd: noSpendCap ? null : Number(spendCapUsd),
                  acknowledgeNoSpendCap: noSpendCap,
                  maxDurationMinutes: maxDurationMinutes ? Number(maxDurationMinutes) : null,
                });
              } catch {
                return;
              }
              setTitle("");
              setSpec("");
              setSpendCapUsd("");
              setNoSpendCap(false);
              setMaxDurationMinutes("");
            }}
          >
            <div className="border-b border-edge px-5 py-4">
              <Dialog.Title className="text-[15px] font-semibold text-ink">New goal</Dialog.Title>
              <Dialog.Description className="mt-1 text-[13px] text-ink-muted">
                Define the objective and operating limits. You will approve the checklist before the goal starts.
              </Dialog.Description>
            </div>

            <div className="space-y-4 px-5 py-4">
              <Field label="Title">
                {(id) => (
                  <Input
                    id={id}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    autoFocus
                  />
                )}
              </Field>
              <Field label="Specification" hint="Describe the objective, requirements, and constraints.">
                {(id) => (
                  <Textarea
                    id={id}
                    rows={5}
                    value={spec}
                    onChange={(event) => setSpec(event.target.value)}
                  />
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Spend cap">
                  {(id) => (
                    <Input
                      id={id}
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="$"
                      className="tnum"
                      value={spendCapUsd}
                      disabled={noSpendCap}
                      onChange={(event) => setSpendCapUsd(event.target.value)}
                    />
                  )}
                </Field>
                <Field label="Maximum duration" hint="Optional, in minutes.">
                  {(id) => (
                    <Input
                      id={id}
                      type="number"
                      min="0"
                      className="tnum"
                      value={maxDurationMinutes}
                      onChange={(event) => setMaxDurationMinutes(event.target.value)}
                    />
                  )}
                </Field>
              </div>
              <CheckboxField
                tone="gate"
                label="Run without a spend cap — an unbounded goal can run overnight and cost real money"
                checked={noSpendCap}
                onCheckedChange={setNoSpendCap}
              />
              {props.error ? <InlineError>{props.error}</InlineError> : null}
            </div>

            <div className="border-t border-edge px-5 py-3.5">
              <FormActions>
                <Dialog.Close asChild>
                  <Button variant="ghost">Cancel</Button>
                </Dialog.Close>
                <Button type="submit" variant="solid" disabled={blocked || props.pending}>
                  {props.pending ? "Creating…" : "Create"}
                </Button>
              </FormActions>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
