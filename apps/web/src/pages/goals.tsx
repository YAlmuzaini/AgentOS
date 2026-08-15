import type { GoalDto } from "@agentos/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Target } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/ui/feedback";
import { CheckboxField, Field, FormActions, Input, Textarea } from "../components/ui/form";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { useActiveProject } from "../hooks/use-project";
import { GoalDetail } from "./goal-detail";
import { NoProject } from "./tasks";

export function GoalsPage(): React.JSX.Element {
  const { project } = useActiveProject();
  const queryClient = useQueryClient();
  const projectId = project?.id;
  const [selected, setSelected] = useState<string | null>(null);
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

  if (!project) {
    return <NoProject />;
  }

  const list = goals.data ?? [];
  const awaiting = list.filter((goal) => !goal.dodApproved).length;

  return (
    <Page>
      <PageHeader
        icon={<Target />}
        title="Goals"
        actions={
          <>
            {awaiting > 0 ? (
              <StatusPill tone="gate" dot>
                {awaiting} awaiting approval
              </StatusPill>
            ) : null}
            <Button variant="solid" onClick={() => setCreating(true)}>
              <Plus />
              New goal
            </Button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <Panel className="h-fit overflow-hidden">
          {list.length === 0 ? (
            <EmptyState
              icon={<Target />}
              title="No goals yet"
              hint="A goal runs its own loop until its definition of done is checked off."
            />
          ) : (
            <ul>
              {list.map((goal) => (
                <li key={goal.id} className="border-b border-edge last:border-0">
                  <button
                    type="button"
                    className={`w-full px-3.5 py-3 text-left transition-colors ${
                      selected === goal.id ? "bg-sunken" : "hover:bg-sunken/70"
                    }`}
                    onClick={() => setSelected(goal.id)}
                    aria-current={selected === goal.id}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="truncate text-[13px] font-medium text-ink">
                        {goal.title}
                      </span>
                      <GoalStatus goal={goal} />
                    </div>
                    <div className="tnum mt-1.5 text-xs text-ink-muted">
                      ${goal.spendUsd.toFixed(2)} of{" "}
                      {goal.spendCapUsd !== null ? `$${goal.spendCapUsd.toFixed(2)}` : "no cap"} ·{" "}
                      {goal.iterations} iterations
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div>
          {selected ? (
            <GoalDetail
              projectId={project.id}
              goalId={selected}
              onChanged={() => queryClient.invalidateQueries({ queryKey: ["goals", projectId] })}
            />
          ) : (
            <Panel>
              <EmptyState
                title="Select a goal"
                hint="Its definition of done, spend against the cap, and progress log open here."
              />
            </Panel>
          )}
        </div>
      </div>

      <CreateGoalDialog
        open={creating}
        onOpenChange={setCreating}
        pending={create.isPending}
        onCreate={(body) => create.mutate(body)}
      />
    </Page>
  );
}

function GoalStatus(props: { goal: GoalDto }): React.JSX.Element {
  if (!props.goal.dodApproved) {
    return <StatusPill tone="gate">awaiting approval</StatusPill>;
  }
  if (props.goal.status === "active") {
    return (
      <StatusPill tone="live" dot pulse>
        active
      </StatusPill>
    );
  }
  // A rail tripped: spend cap, max duration, or stuck-at-19. Each is a real
  // stop the operator has to decide about, so all three read as danger.
  if (props.goal.status.startsWith("stopped-")) {
    return (
      <StatusPill tone="danger" dot>
        {props.goal.status.replace("stopped-", "stopped: ")}
      </StatusPill>
    );
  }
  if (props.goal.status === "completed") {
    return <StatusPill tone="live">completed</StatusPill>;
  }
  return <StatusPill>{props.goal.status}</StatusPill>;
}

function CreateGoalDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onCreate: (body: {
    title: string;
    spec: string;
    spendCapUsd: number | null;
    acknowledgeNoSpendCap: boolean;
    maxDurationMinutes: number | null;
  }) => void;
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
            onSubmit={(event) => {
              event.preventDefault();
              if (blocked) return;
              props.onCreate({
                title,
                spec,
                spendCapUsd: noSpendCap ? null : Number(spendCapUsd),
                acknowledgeNoSpendCap: noSpendCap,
                maxDurationMinutes: maxDurationMinutes ? Number(maxDurationMinutes) : null,
              });
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
                Nothing runs until you approve the checklist on the next screen.
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
              <Field label="Spec" hint="What the goal is, in as much detail as you have.">
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
                <Field label="Max duration" hint="Minutes. Optional.">
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
