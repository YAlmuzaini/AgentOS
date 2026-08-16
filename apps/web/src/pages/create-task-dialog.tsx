import type { AgentDto, ScheduleKind } from "@agentos/shared";
import { SCHEDULE_KINDS } from "@agentos/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { useConfirm } from "../components/ui/confirm";
import { CheckboxField, Field, FormActions, Input, Select, Textarea } from "../components/ui/form";
import { MicroLabel } from "../components/ui/panel";
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
        <Dialog.Content className="rise fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-panel border border-edge bg-panel shadow-pop outline-none">
          <form
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
            <div className="border-b border-edge px-5 py-4">
              <Dialog.Title className="text-[15px] font-semibold text-ink">New task</Dialog.Title>
              <Dialog.Description className="mt-1 text-[13px] text-ink-muted">
                {describeSchedule(scheduleKind)}
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
                    placeholder="Describe the work and completion criteria"
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
                  was to write an automation for it. */}
              <div>
                <MicroLabel className="mb-1.5">Run</MicroLabel>
                <div
                  role="radiogroup"
                  aria-label="Schedule"
                  className="inline-flex rounded-control border border-edge bg-sunken p-0.5"
                >
                  {SCHEDULE_CHOICES.map((choice) => (
                    <button
                      key={choice.kind}
                      type="button"
                      role="radio"
                      aria-checked={scheduleKind === choice.kind}
                      onClick={() => setScheduleKind(choice.kind)}
                      className={`rounded-[6px] px-3 py-1 text-[13px] transition-colors ${
                        scheduleKind === choice.kind
                          ? "bg-panel font-medium text-ink shadow-lift"
                          : "text-ink-muted hover:text-ink"
                      }`}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
              </div>

              {scheduleKind === "at" ? (
                <Field label="Run at">
                  {(id) => (
                    <Input
                      id={id}
                      type="datetime-local"
                      value={runAt}
                      onChange={(event) => setRunAt(event.target.value)}
                    />
                  )}
                </Field>
              ) : null}

              {scheduleKind === "cron" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Cron" hint="Five fields, e.g. 0 9 * * *">
                    {(id) => (
                      <Input
                        id={id}
                        className="machine"
                        placeholder="0 9 * * *"
                        value={cron}
                        onChange={(event) => setCron(event.target.value)}
                      />
                    )}
                  </Field>
                  <Field label="Timezone">
                    {(id) => (
                      <Input
                        id={id}
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
                  create.isError ? <span className="text-danger">Task creation failed.</span> : null
                }
              >
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

/** Shared by every project-scoped screen, so the wording stays identical. */
/**
 * Shown while the project list has not answered yet — or has failed.
 *
 * Deliberately says nothing about the cause. "No project yet, seed one" was
 * rendered in exactly this state and sent the operator to fix a database that
 * was fine; the shell reports the real failure for this same query, so the
 * page's job is to not guess.
 */

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
