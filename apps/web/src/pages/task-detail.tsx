import type { AgentDto, TaskDto } from "@agentos/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Clock,
  GitBranch,
  Pencil,
  Play,
  Repeat,
  ShieldCheck,
  Trash2,
  User,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { api, ApiError } from "../api";
import { Button } from "../components/ui/button";
import { useConfirm } from "../components/ui/confirm";
import { InlineError, SkeletonRows } from "../components/ui/feedback";
import { Field, Input, Textarea } from "../components/ui/form";
import { PanelTitle, Well } from "../components/ui/panel";
import { Dot, StatusPill } from "../components/ui/pill";
import { Time } from "../components/ui/time";
import { cn } from "../lib/cn";
import { TaskAttachments } from "./task-attachments";
import { reflow } from "../lib/prose";
import { HandoffChain } from "./handoff-chain";

/**
 * Everything the control plane knows about one task.
 *
 * The board card can only carry a name and a badge, so description, schedule,
 * chain position and the run history all had nowhere to go — `taskActivity`
 * existed in the client and was never called. This is a sheet rather than a
 * centred dialog so the board stays visible: the operator is usually comparing
 * this card to the ones beside it.
 *
 * The body is a stack of hairline-separated sections in the order the operator
 * reads them: the gate first when there is one, because that is the reason the
 * sheet was opened; then the brief, then the facts, then the paper trail.
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
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge px-5 py-4">
            <div className="min-w-0">
              {/* The name is the one thing the operator came for, and a task
                  name is a sentence — it wraps rather than truncating. */}
              <Dialog.Title className="text-[15px] leading-snug font-semibold break-words text-ink">
                {task.name}
              </Dialog.Title>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {/* Board position is a category, not a state, so it stays a
                    neutral pill — the signal hues are spent on the gate. */}
                <StatusPill tone="neutral">{task.status}</StatusPill>
                {task.approvalGate ? (
                  <StatusPill
                    tone="gate"
                    dot
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
                title="Edit task"
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
                title="Delete task"
                className="text-ink-faint hover:bg-danger-soft hover:text-danger"
                onClick={() =>
                  confirm({
                    kind: "destroy",
                    title: `Delete “${task.name}”?`,
                    body: (
                      <>
                        This deletes the task and its activity history. Existing session records are
                        retained. This action cannot be undone.
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
                <Button variant="ghost" size="icon-sm" aria-label="Close" title="Close">
                  <X />
                </Button>
              </Dialog.Close>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {editing ? (
              <Section>
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    save.mutate();
                  }}
                >
                  <Field label="Name" required>
                    {(id) => (
                      <Input
                        id={id}
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
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
                  {save.isError ? (
                    <InlineError>
                      {save.error instanceof ApiError
                        ? save.error.message
                        : "Unable to save the task."}
                    </InlineError>
                  ) : null}
                  <div className="flex items-center gap-2">
                    <Button type="submit" variant="solid" disabled={save.isPending || !name}>
                      {save.isPending ? "Saving…" : "Save"}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </Section>
            ) : null}

            {remove.isError ? (
              <Section>
                <InlineError>
                  {remove.error instanceof ApiError
                    ? remove.error.message
                    : "Unable to delete the task."}
                </InlineError>
              </Section>
            ) : null}

            {/* The signature moment: an agent moved this to review and cannot
                close it. It is a normal, expected stop, so it is stated in the
                gate tone and in plain words — never a warning triangle. */}
            {task.approvalGate ? (
              <Section>
                <div className="rounded-control border border-gate-line bg-gate-soft px-3.5 py-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck aria-hidden className="size-4 shrink-0 text-gate" />
                    <p className="text-[13px] font-medium text-gate">Approval gate</p>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
                    {task.status === "review"
                      ? "This task is ready for your approval. Approve it below to mark it as done."
                      : task.status === "done"
                        ? "You approved and completed this task."
                        : "This task requires your approval before it can be marked as done."}
                  </p>
                </div>
              </Section>
            ) : null}

            {!editing && task.description ? (
              <Section title="Description">
                <Well className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink">
                  {reflow(task.description)}
                </Well>
              </Section>
            ) : null}

            <Section title="Details">
              <dl className="divide-y divide-edge rounded-control border border-edge">
                <Row label="Assignee" icon={<User />}>
                  {agent ? (
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <span className="truncate">{agent.title}</span>
                      <span className="machine truncate text-ink-muted">{agent.name}</span>
                    </span>
                  ) : (
                    <span className="text-ink-faint">unassigned</span>
                  )}
                </Row>
                <Row label="Schedule" icon={task.scheduleKind === "cron" ? <Repeat /> : <Clock />}>
                  <ScheduleValue task={task} />
                </Row>
                <Row label="Created" icon={<Clock />}>
                  <Time iso={task.createdAt} absolute />
                </Row>
                <Row label="Last moved" icon={<Clock />}>
                  <Time iso={task.updatedAt} />
                </Row>
                {task.chainId ? (
                  <Row label="Chain" icon={<GitBranch />}>
                    {/* chainIndex is zero-based; operators count from one. */}
                    step {(task.chainIndex ?? 0) + 1}
                    {task.templateId ? " of a template chain" : ""}
                  </Row>
                ) : null}
              </dl>
            </Section>

            <Section>
              <TaskAttachments
                projectId={props.projectId}
                taskId={task.id}
                attachmentIds={task.attachmentIds}
              />
            </Section>

            <Section title="History">
              <HandoffChain projectId={props.projectId} taskId={task.id} embedded />
            </Section>

            <Section title="Activity">
              {activity.isLoading ? (
                <SkeletonRows rows={3} />
              ) : (activity.data ?? []).length === 0 ? (
                <Well>
                  <p className="text-[13px] text-ink-faint">
                    No activity recorded. New entries will appear while the agent works.
                  </p>
                </Well>
              ) : (
                <ol className="relative space-y-3.5 before:absolute before:top-1.5 before:bottom-1.5 before:left-[3px] before:w-px before:bg-edge">
                  {[...(activity.data ?? [])]
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                    .map((entry) => (
                      <li key={entry.id} className="relative pl-5">
                        <Dot className="absolute top-1.5 left-0 ring-2 ring-panel" />
                        <Time iso={entry.createdAt} className="block text-ink-faint" absolute />
                        <p className="mt-0.5 text-[13px] leading-relaxed whitespace-pre-wrap text-ink">
                          {reflow(entry.body)}
                        </p>
                      </li>
                    ))}
                </ol>
              )}
            </Section>
          </div>

          {task.status === "todo" || task.status === "review" ? (
            <div className="flex shrink-0 justify-end gap-2 border-t border-edge px-5 py-3.5">
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

/**
 * One band of the sheet. The hairline between bands is what stops five stacked
 * groups from reading as one long column of grey headings.
 */
function Section(props: {
  title?: string;
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <section className={cn("space-y-2 border-b border-edge px-5 py-4 last:border-b-0", props.className)}>
      {props.title ? <PanelTitle>{props.title}</PanelTitle> : null}
      {props.children}
    </section>
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
    <div className="flex items-start gap-3 px-3 py-2.5">
      <dt className="flex w-24 shrink-0 items-center gap-2 text-[13px] text-ink-muted [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-ink-faint">
        {props.icon}
        {props.label}
      </dt>
      <dd className="min-w-0 flex-1 text-[13px] break-words text-ink">{props.children}</dd>
    </div>
  );
}
