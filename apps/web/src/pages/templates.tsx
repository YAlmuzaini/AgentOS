import type { TaskTemplateDto, TemplateStep } from "@agentos/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Download, FolderGit2, Play, ShieldCheck, User } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { DeleteAction } from "../components/ui/delete-action";
import { useConfirm } from "../components/ui/confirm";
import { EmptyState, InlineError, SkeletonRows } from "../components/ui/feedback";
import { Field, FormActions, Input } from "../components/ui/form";
import { IconTile, toneFor } from "../components/ui/icon-tile";
import { Page, PageHeader } from "../components/ui/page";
import { Panel, PanelTitle, Well } from "../components/ui/panel";
import { CountChip, StatusPill } from "../components/ui/pill";
import { useProjectGate } from "../hooks/use-project";
import { NoProject, ProjectPending } from "./project-states";
import { InstantiateDialog } from "./instantiate-dialog";

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
  const { project, pending, absent } = useProjectGate();
  const queryClient = useQueryClient();
  const projectId = project?.id;
  const [previewing, setPreviewing] = useState<TaskTemplateDto | null>(null);
  const confirm = useConfirm();

  const templates = useQuery({
    queryKey: ["templates", projectId],
    queryFn: () => api.templates(projectId!),
    enabled: Boolean(projectId),
  });

  const installBuiltIns = useMutation({
    mutationFn: () => api.installBuiltInTemplates(projectId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["templates", projectId] }),
  });

  /** The endpoint re-installs over whatever is there, so it can overwrite edits. */
  const confirmInstall = (): void =>
    confirm({
      kind: "warn",
      title: "Re-install the built-in templates?",
      body: (
        <>
          This writes the built-in workflows over the existing ones. Any changes you have made to a
          template of the same name will be replaced.
        </>
      ),
      confirmLabel: "Install built-ins",
      onConfirm: () => installBuiltIns.mutate(),
    });

  if (absent) {
    return <NoProject />;
  }
  if (pending || !project) {
    return <ProjectPending />;
  }

  const list = templates.data ?? [];

  return (
    <Page>
      <PageHeader
        icon={<FolderGit2 />}
        title="Templates"
        meta={list.length > 0 ? <CountChip>{list.length}</CountChip> : undefined}
        actions={
          <Button onClick={() => confirmInstall()} disabled={installBuiltIns.isPending}>
            <Download />
            {installBuiltIns.isPending ? "Installing…" : "Install built-ins"}
          </Button>
        }
      />

      {installBuiltIns.isError ? (
        <InlineError>Unable to install the built-in templates.</InlineError>
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
            hint="Install the built-in workflows or define a template in agentos.yml."
            action={
              <Button variant="solid" onClick={() => confirmInstall()}>
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
              projectId={project.id}
              onDeleted={() => api.deleteTemplate(project.id, template.id)}
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
 * A template card, in the order the operator reads it: what this is, what it
 * does, then the chain itself, then what running it would cost them in
 * attention.
 *
 * It used to open with the step list in a grey band and put the name
 * underneath, which meant a wall of four cards led with four unlabelled
 * numbered lists and the operator had to look *down* to find out which
 * workflow each one was. Identity first; the chain is the evidence, not the
 * headline. The actions also sat in two stacked rows — a lone bin icon
 * floating above a full-width button — and are now one row, quiet action
 * left, the thing you came to press right.
 */
function TemplateCard(props: {
  template: TaskTemplateDto;
  onPreview: () => void;
  projectId: string;
  onDeleted: () => Promise<unknown>;
}): React.JSX.Element {
  const { template } = props;
  const gates = template.steps.filter((step) => step.approvalGate).length;

  return (
    <Panel className="flex flex-col gap-3 p-4 transition-colors hover:border-edge-strong">
      <div className="flex min-w-0 items-start gap-2.5">
        <IconTile tone={toneFor(template.id)}>
          <FolderGit2 />
        </IconTile>
        <div className="min-w-0 flex-1">
          <p className="machine truncate text-[13px] font-medium text-ink">{template.name}</p>
          {template.description ? (
            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-ink-muted">
              {template.description}
            </p>
          ) : null}
        </div>
      </div>

      {/* The chain is read-only reference material, so it sits in a well. */}
      <Well className="px-3 py-2.5">
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
            <li className="pl-6 text-xs text-ink-faint">+{template.steps.length - 4} more</li>
          ) : null}
        </ol>
      </Well>

      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        <StatusPill tone="neutral">
          {template.steps.length} {template.steps.length === 1 ? "step" : "steps"}
        </StatusPill>
        {gates > 0 ? (
          <StatusPill
            tone="gate"
            title="An agent cannot close these steps. Only you can."
          >
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

      <div className="flex items-center justify-between gap-2 border-t border-edge pt-3">
        <DeleteAction
          what={template.name}
          body={
            <>
              Existing task chains are not affected. You can restore built-in templates by
              selecting Install built-ins.
            </>
          }
          onDelete={props.onDeleted}
          invalidate={[["templates", props.projectId]]}
        />
        <Button onClick={props.onPreview}>
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
