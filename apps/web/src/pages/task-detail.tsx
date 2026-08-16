import type { AgentDto, TaskDto } from "@agentos/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, GitBranch, Pencil, Play, Repeat, Trash2, User, X } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { api, ApiError } from "../api";
import { Button } from "../components/ui/button";
import { useConfirm } from "../components/ui/confirm";
import { EmptyState, InlineError, SkeletonRows } from "../components/ui/feedback";
import { Field, Input, Textarea } from "../components/ui/form";
import { PanelTitle, Well } from "../components/ui/panel";
import { Dot, StatusPill } from "../components/ui/pill";

/**
 * Everything the control plane knows about one task.
 *
 * The board card can only carry a name and a badge, so description, schedule,
 * chain position and the run history all had nowhere to go — `taskActivity`
 * existed in the client and was never called. This is a sheet rather than a
 * centred dialog so the board stays visible: the operator is usually comparing
 * this card to the ones beside it.
 */
export function TaskDetail(props: {
  projectId: string;
  task: TaskDto;
  agents: AgentDto[];
  busy: boolean;
  onClose: () => void;
  onRun: () => void;
  onApprove: () => void;
}): React.JSX.Element {
  const { task } = props;
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  // Editing is inline rather than a second dialog: the sheet already has the
  // task open, and a dialog over a dialog is a worse place to fix a typo.
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(task.name);
  const [description, setDescription] = useState(task.description);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["tasks", props.projectId] });
    void queryClient.invalidateQueries({ queryKey: ["task", props.projectId, task.id] });
  };

  const save = useMutation({
    mutationFn: () => api.patchTask(props.projectId, task.id, { name, description }),
    onSuccess: () => {
      setEditing(false);
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteTask(props.projectId, task.id),
    onSuccess: () => {
      invalidate();
      props.onClose();
    },
  });

  const activity = useQuery({
    queryKey: ["task-activity", props.projectId, task.id],
    queryFn: () => api.taskActivity(props.projectId, task.id),
    refetchInterval: 5000,
  });

  const agent = props.agents.find((a) => a.id === task.assigneeAgentId);

  return (
    <Dialog.Root open onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[min(30rem,100vw)] flex-col border-l border-edge bg-panel shadow-pop outline-none">
          <div className="flex items-start justify-between gap-3 border-b border-edge px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-[15px] font-semibold text-ink">
                {task.name}
              </Dialog.Title>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <StatusPill tone={task.status === "done" ? "live" : "neutral"}>
                  {task.status}
                </StatusPill>
                {task.approvalGate ? (
                  <StatusPill
                    tone="gate"
                    title="An agent cannot mark this done. Only you can close it."
                  >
                    approval gate
                  </StatusPill>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Edit task"
                onClick={() => {
                  setName(task.name);
                  setDescription(task.description);
                  setEditing((open) => !open);
                }}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete task"
                className="text-ink-faint hover:bg-danger-soft hover:text-danger"
                onClick={() =>
                  confirm({
                    kind: "destroy",
                    title: `Delete “${task.name}”?`,
                    body: (
                      <>
                        The card and its activity go with it. Sessions that already ran are kept —
                        they are the record of what happened and what it cost. This cannot be undone.
                      </>
                    ),
                    confirmLabel: "Delete task",
                    onConfirm: () => remove.mutate(),
                  })
                }
              >
                <Trash2 />
              </Button>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Close">
                  <X />
                </Button>
              </Dialog.Close>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            {editing ? (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  save.mutate();
                }}
              >
                <Field label="Name">
                  {(id) => (
                    <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />
                  )}
                </Field>
                <Field label="Description">
                  {(id) => (
                    <Textarea
                      id={id}
                      rows={6}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  )}
                </Field>
                <div className="flex items-center gap-2">
                  <Button type="submit" variant="solid" disabled={save.isPending || !name}>
                    {save.isPending ? "Saving…" : "Save"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                  {save.isError ? (
                    <span className="text-[13px] text-danger">
                      {save.error instanceof ApiError ? save.error.message : "could not save"}
                    </span>
                  ) : null}
                </div>
              </form>
            ) : null}

            {remove.isError ? (
              <InlineError>
                {remove.error instanceof ApiError ? remove.error.message : "could not delete"}
              </InlineError>
            ) : null}

            {!editing && task.description ? (
              <div className="space-y-2">
                <PanelTitle>Description</PanelTitle>
                <Well className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink">
                  {task.description}
                </Well>
              </div>
            ) : null}

            <div className="space-y-2">
              <PanelTitle>Details</PanelTitle>
              <dl className="divide-y divide-edge rounded-control border border-edge">
                <Row label="Assignee" icon={<User />}>
                  {agent ? (
                    <span className="machine">{agent.name}</span>
                  ) : (
                    <span className="text-ink-faint">unassigned</span>
                  )}
                </Row>
                <Row label="Schedule" icon={task.scheduleKind === "cron" ? <Repeat /> : <Clock />}>
                  <ScheduleValue task={task} />
                </Row>
                {task.chainId ? (
                  <Row label="Chain" icon={<GitBranch />}>
                    {/* chainIndex is zero-based; operators count from one. */}
                    step {(task.chainIndex ?? 0) + 1}
                    {task.templateId ? " of a template chain" : ""}
                  </Row>
                ) : null}
              </dl>
            </div>

            <div className="space-y-2">
              <PanelTitle>History</PanelTitle>
              {activity.isLoading ? (
                <SkeletonRows rows={3} />
              ) : (activity.data ?? []).length === 0 ? (
                <Well>
                  <p className="text-[13px] text-ink-faint">
                    Nothing logged yet. Entries appear as the agent works.
                  </p>
                </Well>
              ) : (
                <ol className="relative space-y-3.5 before:absolute before:top-1.5 before:bottom-1.5 before:left-[3px] before:w-px before:bg-edge">
                  {[...(activity.data ?? [])]
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                    .map((entry) => (
                      <li key={entry.id} className="relative pl-5">
                        <Dot className="absolute top-1.5 left-0 ring-2 ring-panel" />
                        <div className="machine text-xs text-ink-faint">
                          {entry.createdAt.slice(0, 19).replace("T", " ")}
                        </div>
                        <p className="mt-0.5 text-[13px] leading-relaxed whitespace-pre-wrap text-ink">
                          {entry.body}
                        </p>
                      </li>
                    ))}
                </ol>
              )}
            </div>
          </div>

          {task.status === "todo" || task.status === "review" ? (
            <div className="flex justify-end gap-2 border-t border-edge px-5 py-3.5">
              {task.status === "todo" ? (
                <Button variant="solid" onClick={props.onRun} disabled={props.busy}>
                  <Play />
                  Run now
                </Button>
              ) : (
                <Button variant="solid" onClick={props.onApprove} disabled={props.busy}>
                  <Check />
                  Approve → done
                </Button>
              )}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ScheduleValue(props: { task: TaskDto }): React.JSX.Element {
  const { task } = props;
  if (task.scheduleKind === "cron") {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="machine">{task.cron}</span>
        <span className="text-ink-muted">{task.timezone}</span>
      </span>
    );
  }
  if (task.scheduleKind === "at" && task.runAt) {
    return <span className="machine">{task.runAt.slice(0, 19).replace("T", " ")}</span>;
  }
  return <span className="text-ink-muted">immediately</span>;
}

function Row(props: { label: string; icon: ReactNode; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <dt className="flex w-28 shrink-0 items-center gap-2 text-[13px] text-ink-muted [&_svg]:size-3.5 [&_svg]:text-ink-faint">
        {props.icon}
        {props.label}
      </dt>
      <dd className="min-w-0 flex-1 text-[13px] text-ink">{props.children}</dd>
    </div>
  );
}

export { EmptyState };
