import type { TaskTemplateDto, TemplateStep } from "@agentos/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Download, FolderGit2, Play, ShieldCheck, User } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { useConfirm } from "../components/ui/confirm";
import { EmptyState, InlineError, SkeletonRows } from "../components/ui/feedback";
import { Field, FormActions, Input } from "../components/ui/form";
import { Page, PageHeader } from "../components/ui/page";
import { Panel, PanelTitle, Well } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
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
        meta={list.length > 0 ? `${list.length} available` : undefined}
        actions={
          <Button onClick={() => confirmInstall()} disabled={installBuiltIns.isPending}>
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
