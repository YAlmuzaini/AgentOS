import type { AgentDto, ScheduleKind } from "@agentos/shared";
import { SCHEDULE_KINDS } from "@agentos/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api, ApiError } from "../api";
import { Button } from "../components/ui/button";
import { useConfirm } from "../components/ui/confirm";
import { InlineError } from "../components/ui/feedback";
import { CheckboxField, Field, FormActions, Input, Select, Textarea } from "../components/ui/form";
import { cn } from "../lib/cn";
import { AttachmentPicker, type PickedAttachment } from "./attachment-picker";

const SCHEDULE_LABEL: Record<ScheduleKind, string> = {
  now: "Now",
  at: "At a time",
  cron: "On a schedule",
};

const SCHEDULE_CHOICES = SCHEDULE_KINDS.map((kind) => ({
  kind,
  label: SCHEDULE_LABEL[kind],
}));

export function CreateTaskDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  agents: Array<{ id: string; name: string }>;
  onCreated: () => void;
}): React.JSX.Element {
  const scheduleLabelId = useId();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agentId, setAgentId] = useState("");
  const [approvalGate, setApprovalGate] = useState(false);
  const [attachments, setAttachments] = useState<PickedAttachment[]>([]);
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind>("now");
  const confirm = useConfirm();
  const [runAt, setRunAt] = useState("");
  const [cron, setCron] = useState("");
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );

  const create = useMutation({
    mutationFn: () =>
      api.createTask(props.projectId, {
        name,
        description,
        assigneeType: "agent",
        assigneeAgentId: agentId,
        attachmentIds: attachments.map((attachment) => attachment.id),
        approvalGate,
        scheduleKind,
        // The server rejects a mismatched pair, so only send the fields the
        // chosen kind actually uses.
        runAt: scheduleKind === "at" && runAt ? new Date(runAt) : null,
        cron: scheduleKind === "cron" ? cron : null,
        timezone: scheduleKind === "cron" ? timezone : null,
      }),
    onSuccess: () => {
      setName("");
      setDescription("");
      setRunAt("");
      setCron("");
      setAttachments([]);
      props.onCreated();
    },
  });

  const scheduleIncomplete =
    (scheduleKind === "at" && !runAt) || (scheduleKind === "cron" && (!cron || !timezone));

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        {/* The form grows: a cron schedule and three attachments are taller
            than a laptop lid open at 768px, so the dialog is capped and its
            body scrolls while the title and the actions stay put. */}
        <Dialog.Content className="rise fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-panel border border-edge bg-panel shadow-pop outline-none">
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name || !agentId) {
                return;
              }
              // A task created with "Now" starts an agent on submit — the same
              // spend as pressing Run, and it was the one path that asked
              // nothing first. Scheduled kinds commit money later, so they are
              // confirmed for what they actually do rather than not at all.
              if (scheduleKind === "now") {
                confirm({
                  kind: "spend",
                  title: `Create and run “${name}”?`,
                  body: (
                    <>
                      This starts an agent session immediately and consumes API credits. This action
                      cannot be reversed.
                    </>
                  ),
                  confirmLabel: "Create and run",
                  onConfirm: () => create.mutate(),
                });
                return;
              }
              create.mutate();
            }}
          >
            <div className="shrink-0 border-b border-edge px-5 py-4">
              <Dialog.Title className="text-[15px] font-semibold text-ink">New task</Dialog.Title>
              <Dialog.Description className="mt-1 text-[13px] text-ink-muted">
                {describeSchedule(scheduleKind)}
              </Dialog.Description>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <Field label="Name" required>
                {(id) => (
                  <Input
                    id={id}
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Reconcile the Q2 invoice export"
                    autoFocus
                  />
                )}
              </Field>
              <Field label="Description" hint="Read by the agent as its brief.">
                {(id) => (
                  <Textarea
                    id={id}
                    rows={3}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Describe the work and completion criteria"
                  />
                )}
              </Field>
              <Field label="Assign to" required>
                {(id) => (
                  <Select
                    id={id}
                    required
                    value={agentId}
                    onChange={(event) => setAgentId(event.target.value)}
                  >
                    <option value="">Select an agent</option>
                    {props.agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {/* The API has supported at/cron scheduling all along; this form
                  used to hardcode "now", so the only way to schedule a task
                  was to write an automation for it.

                  The caption is the same 13px label every field above it wears
                  — it used to be the 11px all-caps micro label, which made the
                  one control that is not an input look like a table heading. */}
              <div className="space-y-1.5">
                <p id={scheduleLabelId} className="text-[13px] font-medium text-ink">
                  Run
                </p>
                <div
                  role="radiogroup"
                  aria-labelledby={scheduleLabelId}
                  className="inline-flex h-8.5 items-center rounded-control border border-edge bg-sunken p-0.5"
                >
                  {SCHEDULE_CHOICES.map((choice) => (
                    <button
                      key={choice.kind}
                      type="button"
                      role="radio"
                      aria-checked={scheduleKind === choice.kind}
                      onClick={() => setScheduleKind(choice.kind)}
                      className={cn(
                        "h-full rounded-[6px] px-3 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-solid",
                        scheduleKind === choice.kind
                          ? "bg-panel font-medium text-ink shadow-lift"
                          : "text-ink-muted hover:text-ink",
                      )}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
              </div>

              {scheduleKind === "at" ? (
                <Field label="Run at" required hint="In this browser's timezone.">
                  {(id) => (
                    <Input
                      id={id}
                      required
                      type="datetime-local"
                      value={runAt}
                      onChange={(event) => setRunAt(event.target.value)}
                    />
                  )}
                </Field>
              ) : null}

              {scheduleKind === "cron" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Cron" required hint="Five fields, e.g. 0 9 * * *">
                    {(id) => (
                      <Input
                        id={id}
                        required
                        className="machine"
                        placeholder="0 9 * * *"
                        value={cron}
                        onChange={(event) => setCron(event.target.value)}
                      />
                    )}
                  </Field>
                  <Field label="Timezone" required>
                    {(id) => (
                      <Input
                        id={id}
                        required
                        className="machine"
                        value={timezone}
                        onChange={(event) => setTimezone(event.target.value)}
                      />
                    )}
                  </Field>
                </div>
              ) : null}

              <AttachmentPicker
                projectId={props.projectId}
                value={attachments}
                onChange={setAttachments}
              />

              {/* The gate is the product's promise in one checkbox, so it gets
                  its own surface and turns amber when it is armed rather than
                  sitting as the last unremarkable line of the form. */}
              <div
                className={cn(
                  "rounded-control border px-3 py-2.5 transition-colors",
                  approvalGate ? "border-gate-line bg-gate-soft" : "border-edge",
                )}
              >
                <CheckboxField
                  label="Require my approval before this can be marked done"
                  checked={approvalGate}
                  onCheckedChange={setApprovalGate}
                  tone={approvalGate ? "gate" : "default"}
                />
              </div>

              {/* The failure surface. It used to be three words in the action
                  bar — "Task creation failed." — which told an operator whose
                  cron expression the server rejected nothing they could act
                  on. */}
              {create.isError ? (
                <InlineError>
                  {create.error instanceof ApiError
                    ? create.error.message
                    : "Unable to create the task."}
                </InlineError>
              ) : null}
            </div>

            <div className="shrink-0 border-t border-edge px-5 py-3.5">
              <FormActions>
                <Dialog.Close asChild>
                  <Button variant="ghost">Cancel</Button>
                </Dialog.Close>
                <Button
                  type="submit"
                  variant="solid"
                  disabled={!name || !agentId || scheduleIncomplete || create.isPending}
                >
                  {create.isPending
                    ? "Creating…"
                    : scheduleKind === "now"
                      ? "Create & run"
                      : "Create & schedule"}
                </Button>
              </FormActions>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The dialog's own subtitle: what pressing the button is about to commit to. */
function describeSchedule(kind: ScheduleKind): string {
  switch (kind) {
    case "now":
      return "The task will start immediately and consume API credits.";
    case "at":
      return "The task will run once at the selected time.";
    case "cron":
      return "The task will run on the specified schedule until deleted.";
  }
}
