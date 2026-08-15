import type { TaskTemplateDto, TemplateStep } from "@agentos/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Download, FolderGit2, Play, ShieldCheck, User } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { EmptyState, InlineError, SkeletonRows } from "../components/ui/feedback";
import { Field, FormActions, Input } from "../components/ui/form";
import { Page, PageHeader } from "../components/ui/page";
import { Panel, PanelTitle, Well } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { useActiveProject } from "../hooks/use-project";
import { NoProject } from "./tasks";

/**
 * Task templates (SPEC §9.4).
 *
 * A template is a chain: instantiating it creates every card at once, and step
 * N+1 stays blocked until step N is done. The whole feature already existed in
 * the API — list, install-built-ins, instantiate — and the only thing that ever
 * called it was a dropdown on the automation form, so an operator could not see
 * what a chain contained or run one by hand.
 */
export function TemplatesPage(): React.JSX.Element {
  const { project } = useActiveProject();
  const queryClient = useQueryClient();
  const projectId = project?.id;
  const [previewing, setPreviewing] = useState<TaskTemplateDto | null>(null);

  const templates = useQuery({
    queryKey: ["templates", projectId],
    queryFn: () => api.templates(projectId!),
    enabled: Boolean(projectId),
  });

  const installBuiltIns = useMutation({
    mutationFn: () => api.installBuiltInTemplates(projectId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["templates", projectId] }),
  });

  if (!project) {
    return <NoProject />;
  }

  const list = templates.data ?? [];

  return (
    <Page>
      <PageHeader
        icon={<FolderGit2 />}
        title="Templates"
        meta={list.length > 0 ? `${list.length} available` : undefined}
        actions={
          <Button onClick={() => installBuiltIns.mutate()} disabled={installBuiltIns.isPending}>
            <Download />
            {installBuiltIns.isPending ? "Installing…" : "Install built-ins"}
          </Button>
        }
      />

      {installBuiltIns.isError ? (
        <InlineError>Could not install the built-in templates.</InlineError>
      ) : null}

      {templates.isLoading ? (
        <Panel>
          <SkeletonRows rows={3} />
        </Panel>
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<FolderGit2 />}
            title="No templates yet"
            hint="Install the built-in workflows, or define your own in agentos.yml."
            action={
              <Button variant="solid" onClick={() => installBuiltIns.mutate()}>
                <Download />
                Install built-ins
              </Button>
            }
          />
        </Panel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onPreview={() => setPreviewing(template)}
            />
          ))}
        </div>
      )}

      {previewing ? (
        <InstantiateDialog
          projectId={project.id}
          template={previewing}
          onClose={() => setPreviewing(null)}
        />
      ) : null}
    </Page>
  );
}

/**
 * The reference's template card: a preview of the chain, then its name and the
 * line of metadata that tells you what running it would do. The preview is the
 * steps themselves rather than an illustration — the chain IS the content.
 */
function TemplateCard(props: {
  template: TaskTemplateDto;
  onPreview: () => void;
}): React.JSX.Element {
  const { template } = props;
  const gates = template.steps.filter((step) => step.approvalGate).length;

  return (
    <Panel className="flex flex-col overflow-hidden transition-colors hover:border-edge-strong">
      <div className="bg-sunken p-4">
        <ol className="space-y-1.5">
          {template.steps.slice(0, 4).map((step, index) => (
            <li key={index} className="flex items-center gap-2 text-xs">
              <span className="tnum w-4 shrink-0 text-ink-faint">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{step.name}</span>
              {step.approvalGate ? (
                <ShieldCheck className="size-3 shrink-0 text-gate" aria-label="approval gate" />
              ) : null}
            </li>
          ))}
          {template.steps.length > 4 ? (
            <li className="pl-6 text-xs text-ink-faint">
              +{template.steps.length - 4} more
            </li>
          ) : null}
        </ol>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="machine text-[13px] font-medium text-ink">{template.name}</p>
        {template.description ? (
          <p className="line-clamp-2 text-xs text-ink-muted">{template.description}</p>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
          <StatusPill tone="neutral">
            {template.steps.length} {template.steps.length === 1 ? "step" : "steps"}
          </StatusPill>
          {gates > 0 ? (
            <StatusPill tone="gate">
              {gates} {gates === 1 ? "gate" : "gates"}
            </StatusPill>
          ) : null}
          {template.variables.length > 0 ? (
            <StatusPill tone="idle">
              {template.variables.length}{" "}
              {template.variables.length === 1 ? "variable" : "variables"}
            </StatusPill>
          ) : null}
        </div>

        <Button className="mt-2 w-full" onClick={props.onPreview}>
          <Play />
          Use template
        </Button>
      </div>
    </Panel>
  );
}

/**
 * Preview the chain, fill the declared variables, and create it.
 *
 * The variables are required by the API, so the form refuses to submit until
 * every declared name has a value — an interpolation that silently left
 * `{{branchName}}` in a prompt would reach the agent as literal text.
 */
function InstantiateDialog(props: {
  projectId: string;
  template: TaskTemplateDto;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<string, string>>({});
  const [titlePrefix, setTitlePrefix] = useState("");

  const instantiate = useMutation({
    mutationFn: () =>
      api.instantiateTemplate(props.projectId, props.template.id, {
        variables: values,
        titlePrefix,
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
              <div className="space-y-3">
                <PanelTitle>Variables</PanelTitle>
                {props.template.variables.map((name) => (
                  <Field key={name} label={name}>
                    {(id) => (
                      <Input
                        id={id}
                        className="machine"
                        value={values[name] ?? ""}
                        onChange={(event) =>
                          setValues({ ...values, [name]: event.target.value })
                        }
                      />
                    )}
                  </Field>
                ))}
              </div>
            ) : null}

            <Field label="Title prefix" hint="Optional. Makes the chain identifiable on the board.">
              {(id) => (
                <Input
                  id={id}
                  value={titlePrefix}
                  onChange={(event) => setTitlePrefix(event.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="border-t border-edge px-5 py-3.5">
            <FormActions
              message={
                instantiate.isError ? (
                  <span className="text-danger">Could not create the chain.</span>
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
                disabled={missing.length > 0 || instantiate.isPending}
                onClick={() => instantiate.mutate()}
              >
                {instantiate.isPending
                  ? "Creating…"
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

function StepRow(props: { index: number; step: TemplateStep }): React.JSX.Element {
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
