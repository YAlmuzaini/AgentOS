import { TASK_STATUSES, type TaskDto, type TaskStatus } from "@agentos/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Check, Play, Plus, SquareKanban } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { CheckboxField, Field, FormActions, Input, Select, Textarea } from "../components/ui/form";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { CountChip, StatusPill } from "../components/ui/pill";
import { useActiveProject } from "../hooks/use-project";

const COLUMN_TITLE: Record<TaskStatus, string> = {
  todo: "To do",
  doing: "Doing",
  review: "Review",
  done: "Done",
};

const EMPTY_COLUMN_TEXT: Record<TaskStatus, string> = {
  todo: "No tasks queued. Create one.",
  doing: "Nothing running right now.",
  review: "Nothing waiting on review.",
  done: "No completed tasks yet.",
};

/** The column head keeps its status colour; the cards below stay neutral. */
const COLUMN_DOT: Record<TaskStatus, string> = {
  todo: "bg-ink-faint",
  doing: "bg-data-sky",
  review: "bg-gate",
  done: "bg-live",
};

export function TasksPage(): React.JSX.Element {
  const { project, isLoading } = useActiveProject();
  const queryClient = useQueryClient();
  const projectId = project?.id;

  // The dialog is opened by the top bar's create button via `?new`, so the
  // board itself does not carry a second create control.
  const search = useSearch({ from: "/tasks" });
  const navigate = useNavigate();
  const creating = search.new === true;
  const setCreating = (open: boolean): void => {
    void navigate({ to: "/tasks", search: open ? { new: true } : {}, replace: true });
  };

  const tasks = useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => api.tasks(projectId!),
    enabled: Boolean(projectId),
    // A run moves the card without a user action, so poll while the board is open.
    refetchInterval: 4000,
  });

  const agents = useQuery({
    queryKey: ["agents", projectId],
    queryFn: () => api.agents(projectId!),
    enabled: Boolean(projectId),
  });

  const patch = useMutation({
    mutationFn: (input: { id: string; status: TaskStatus }) =>
      api.patchTask(projectId!, input.id, { status: input.status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks", projectId] }),
  });

  const run = useMutation({
    mutationFn: (id: string) => api.runTask(projectId!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks", projectId] }),
  });

  if (isLoading) {
    return (
      <Page>
        <SkeletonRows rows={5} />
      </Page>
    );
  }
  if (!project) {
    return <NoProject />;
  }

  const gated = (tasks.data ?? []).filter(
    (task) => task.status === "review" && task.approvalGate,
  ).length;

  return (
    <Page>
      <PageHeader
        icon={<SquareKanban />}
        title="Tasks"
        meta={project.name}
        actions={
          gated > 0 ? (
            <StatusPill tone="gate" dot>
              {gated} waiting on you
            </StatusPill>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {TASK_STATUSES.map((status) => {
          const columnTasks = (tasks.data ?? []).filter((task) => task.status === status);
          return (
            <section key={status} className="flex min-w-0 flex-col gap-2">
              <div className="flex items-center gap-2 px-0.5">
                <span aria-hidden className={`size-1.5 rounded-full ${COLUMN_DOT[status]}`} />
                <h2 className="text-[13px] font-medium text-ink">{COLUMN_TITLE[status]}</h2>
                <CountChip>{columnTasks.length}</CountChip>
              </div>

              <ul className="space-y-2">
                {columnTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    busy={run.isPending || patch.isPending}
                    onRun={() => run.mutate(task.id)}
                    onAdvance={(next) => patch.mutate({ id: task.id, status: next })}
                  />
                ))}
              </ul>

              {columnTasks.length === 0 ? (
                <p className="rounded-panel border border-dashed border-edge px-3 py-6 text-center text-[13px] text-ink-faint">
                  {EMPTY_COLUMN_TEXT[status]}
                </p>
              ) : null}
            </section>
          );
        })}
      </div>

      <CreateTaskDialog
        open={creating}
        onOpenChange={setCreating}
        projectId={project.id}
        agents={agents.data ?? []}
        onCreated={() => {
          setCreating(false);
          void queryClient.invalidateQueries({ queryKey: ["tasks", project.id] });
        }}
      />
    </Page>
  );
}

function TaskCard(props: {
  task: TaskDto;
  busy: boolean;
  onRun: () => void;
  onAdvance: (next: TaskStatus) => void;
}): React.JSX.Element {
  const { task } = props;
  const action =
    task.status === "todo" ? (
      <Button size="sm" onClick={props.onRun} disabled={props.busy}>
        <Play />
        Run now
      </Button>
    ) : task.status === "review" ? (
      <Button size="sm" variant="solid" onClick={() => props.onAdvance("done")} disabled={props.busy}>
        <Check />
        Approve → done
      </Button>
    ) : null;

  return (
    <li>
      <Panel className="p-3 transition-colors hover:border-edge-strong">
        <p className="text-[13px] font-medium text-ink">{task.name}</p>
        {task.approvalGate ? (
          <StatusPill tone="gate" className="mt-2">
            approval gate — only you can close this
          </StatusPill>
        ) : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </Panel>
    </li>
  );
}

function CreateTaskDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  agents: Array<{ id: string; name: string }>;
  onCreated: () => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agentId, setAgentId] = useState("");
  const [approvalGate, setApprovalGate] = useState(false);

  const create = useMutation({
    mutationFn: () =>
      api.createTask(props.projectId, {
        name,
        description,
        assigneeType: "agent",
        assigneeAgentId: agentId,
        approvalGate,
        scheduleKind: "now",
      }),
    onSuccess: () => {
      setName("");
      setDescription("");
      props.onCreated();
    },
  });

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content className="rise fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-panel border border-edge bg-panel shadow-pop outline-none">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (name && agentId) {
                create.mutate();
              }
            }}
          >
            <div className="border-b border-edge px-5 py-4">
              <Dialog.Title className="text-[15px] font-semibold text-ink">New task</Dialog.Title>
              <Dialog.Description className="mt-1 text-[13px] text-ink-muted">
                It is queued and run immediately once created.
              </Dialog.Description>
            </div>

            <div className="space-y-4 px-5 py-4">
              <Field label="Name">
                {(id) => (
                  <Input
                    id={id}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Reconcile the Q2 invoice export"
                    autoFocus
                  />
                )}
              </Field>
              <Field label="Description">
                {(id) => (
                  <Textarea
                    id={id}
                    rows={3}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="What the agent should do, and what done looks like"
                  />
                )}
              </Field>
              <Field label="Assign to">
                {(id) => (
                  <Select
                    id={id}
                    value={agentId}
                    onChange={(event) => setAgentId(event.target.value)}
                  >
                    <option value="">assign agent…</option>
                    {props.agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <CheckboxField
                label="Require my approval before this can be marked done"
                checked={approvalGate}
                onCheckedChange={setApprovalGate}
                tone={approvalGate ? "gate" : "default"}
              />
            </div>

            <div className="border-t border-edge px-5 py-3.5">
              <FormActions
                message={
                  create.isError ? <span className="text-danger">Could not create it.</span> : null
                }
              >
                <Dialog.Close asChild>
                  <Button variant="ghost">Cancel</Button>
                </Dialog.Close>
                <Button
                  type="submit"
                  variant="solid"
                  disabled={!name || !agentId || create.isPending}
                >
                  {create.isPending ? "Creating…" : "Create & run"}
                </Button>
              </FormActions>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Shared by every project-scoped screen, so the wording stays identical. */
export function NoProject(): React.JSX.Element {
  return (
    <Page>
      <Panel>
        <EmptyState
          icon={<SquareKanban />}
          title="No project yet"
          hint={
            <>
              Seed one with <code className="text-ink">pnpm db:seed</code>, then reload.
            </>
          }
        />
      </Panel>
    </Page>
  );
}
