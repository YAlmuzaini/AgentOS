import type { TaskTemplateDto, TemplateStep } from "@agentos/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "../api";
import { useConfirm } from "../components/ui/confirm";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { Field, FormActions, Input } from "../components/ui/form";
import { PanelTitle, Well } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { ArrowRight, User } from "lucide-react";
import type { PreflightReport } from "@agentos/shared";
import { WarningGate } from "../components/warning-gate";

/** Turning a template into nine real cards, with its variables filled in. */
export function InstantiateDialog(props: {
  projectId: string;
  template: TaskTemplateDto;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [values, setValues] = useState<Record<string, string>>({});
  const [titlePrefix, setTitlePrefix] = useState("");
  // Which variables the operator has already been in. A dialog that opens with
  // every field already red is telling them off for not having typed yet.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [preflight, setPreflight] = useState<PreflightReport | null>(null);
  const [checkedSignature, setCheckedSignature] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const signature = JSON.stringify(values);
  const check = useMutation({
    mutationFn: () => api.preflightWithInputs(props.projectId, { subjectType: "template", subjectId: props.template.id, inputs: values }),
    onSuccess: (report) => { setPreflight(report); setCheckedSignature(signature); setAcknowledged(false); },
  });
  const preflightWarnings = (preflight?.findings ?? [])
    .filter((finding) => finding.severity === "warning")
    .map((finding) => finding.message);

  const instantiate = useMutation({
    mutationFn: () =>
      api.instantiateTemplate(props.projectId, props.template.id, {
        variables: values,
        titlePrefix,
        // The operator's own tick. The server rejects an unacknowledged
        // warning; answering its question for it defeats the gate.
        acknowledgePreflightWarnings: acknowledged,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["tasks", props.projectId] });
      props.onClose();
      void navigate({ to: "/tasks" });
    },
  });

  const missing = props.template.variables.filter((name) => !values[name]?.trim());

  return (
    <Dialog.Root open onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <Dialog.Content className="rise fixed top-1/2 left-1/2 z-50 max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-panel border border-edge bg-panel shadow-pop outline-none">
          <div className="flex items-start justify-between gap-3 border-b border-edge px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="machine truncate text-[15px] font-semibold text-ink">
                {props.template.name}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-[13px] text-ink-muted">
                {props.template.description ||
                  "Creates every step at once. Each step waits for the one before it."}
              </Dialog.Description>
            </div>
            <StatusPill tone="neutral">template</StatusPill>
          </div>

          <div className="space-y-4 px-5 py-4">
            <div>
              <PanelTitle className="mb-2">Steps</PanelTitle>
              <Well className="p-0">
                <ol className="divide-y divide-edge">
                  {props.template.steps.map((step, index) => (
                    <StepRow key={index} index={index} step={step} />
                  ))}
                </ol>
              </Well>
            </div>

            {props.template.variables.length > 0 ? (
              <div className="space-y-3 border-t border-edge pt-4">
                <PanelTitle>Variables</PanelTitle>
                <p className="text-xs leading-relaxed text-ink-muted">
                  Every declared variable is substituted into the step prompts. A blank one would
                  reach the agent as literal text, so all of them are required.
                </p>
                {props.template.variables.map((name) => (
                  <Field
                    key={name}
                    label={name}
                    required
                    hint={
                      <>
                        Replaces <span className="machine">{`{{${name}}}`}</span> in every step.
                      </>
                    }
                    error={
                      touched[name] && !values[name]?.trim() ? "Value is required." : undefined
                    }
                  >
                    {(id) => (
                      <Input
                        id={id}
                        className="machine"
                        value={values[name] ?? ""}
                        autoComplete="off"
                        spellCheck={false}
                        onBlur={() => setTouched({ ...touched, [name]: true })}
                        onChange={(event) => {
                          setTouched({ ...touched, [name]: true });
                          setValues({ ...values, [name]: event.target.value });
                        }}
                      />
                    )}
                  </Field>
                ))}
              </div>
            ) : null}

            <Field
              label="Title prefix"
              hint="Optional. Makes the chain identifiable on the board."
              className="border-t border-edge pt-4"
            >
              {(id) => (
                <Input
                  id={id}
                  value={titlePrefix}
                  onChange={(event) => setTitlePrefix(event.target.value)}
                />
              )}
            </Field>
            {preflight && checkedSignature === signature ? (
              <div className="space-y-2 border-t border-edge pt-4" aria-live="polite">
                <PanelTitle>Fleet preflight</PanelTitle>
                <p className={preflight.ready ? "text-xs text-ink-muted" : "text-xs text-danger"}>{preflight.ready ? "Fleet is ready for this workflow." : "Dispatch is blocked."}</p>
                {preflight.findings.filter((finding) => finding.severity === "error").map((finding, index) => <p key={`${finding.code}:${index}`} className="text-xs leading-relaxed text-ink-muted"><span className="text-danger">error:</span> {finding.message}</p>)}
                <WarningGate
                  warnings={preflightWarnings}
                  acknowledged={acknowledged}
                  onAcknowledge={setAcknowledged}
                  label="I have read every warning above and want to run this workflow anyway."
                />
              </div>
            ) : null}
          </div>

          <div className="border-t border-edge px-5 py-3.5">
            <FormActions
              message={
                instantiate.isError ? (
                  <span className="text-danger">Unable to create the task chain.</span>
                ) : missing.length > 0 ? (
                  <span className="text-ink-muted">
                    {missing.length} variable{missing.length === 1 ? "" : "s"} still needed
                  </span>
                ) : null
              }
            >
              <Button variant="ghost" onClick={props.onClose}>
                Cancel
              </Button>
              <Button
                variant="solid"
                disabled={missing.length > 0 || instantiate.isPending || check.isPending || (Boolean(preflight?.ready) && checkedSignature === signature && preflightWarnings.length > 0 && !acknowledged)}
                onClick={() => {
                  if (!preflight || checkedSignature !== signature || !preflight.ready) {
                    check.mutate();
                    return;
                  }
                  confirm({
                    kind: "spend",
                    title: `Create ${props.template.steps.length} tasks from this template?`,
                    body: (
                      <>
                        Every step is created at once and the first one starts immediately,
                        consuming API credits. Later steps stay blocked until the step before them
                        is done.
                      </>
                    ),
                    confirmLabel: `Create ${props.template.steps.length} tasks`,
                    onConfirm: () => instantiate.mutate(),
                  });
                }}
              >
                {check.isPending ? "Checking fleet…" : instantiate.isPending
                  ? "Creating…"
                  : !preflight || checkedSignature !== signature || !preflight.ready
                    ? "Run preflight"
                  : `Create ${props.template.steps.length} tasks`}
                <ArrowRight />
              </Button>
            </FormActions>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function StepRow(props: { index: number; step: TemplateStep }): React.JSX.Element {
  const { step } = props;
  return (
    <li className="flex items-start gap-2.5 px-3.5 py-2.5">
      <span className="tnum mt-0.5 w-4 shrink-0 text-xs text-ink-faint">{props.index + 1}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-ink">{step.name}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
          <span className="flex items-center gap-1">
            <User className="size-3" />
            <span className="machine">{step.agentName}</span>
          </span>
          {step.approvalGate ? (
            <StatusPill tone="gate" title="An agent cannot mark this step done. Only you can.">
              gate
            </StatusPill>
          ) : null}
          {step.attachmentsFromPrevious && props.index > 0 ? (
            <span className="text-ink-faint">carries attachments</span>
          ) : null}
        </div>
      </div>
    </li>
  );
}
