import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProjectDto } from "@agentos/shared";
import { TriangleAlert } from "lucide-react";
import { api, ApiError } from "../api";
import { Button } from "../components/ui/button";
import { useConfirm } from "../components/ui/confirm";
import { Field, FormActions, Input } from "../components/ui/form";
import { MicroLabel, Panel, PanelHeader, PanelTitle, Well } from "../components/ui/panel";
import { selectProject, useProjects } from "../hooks/use-project";
import { useState } from "react";

/**
 * Deleting a whole project.
 *
 * The only action in the app that destroys work rather than configuration, so
 * it asks for the slug to be typed rather than for a click. Everything goes:
 * agents, tasks, goals, sessions and their history, repos, secrets references,
 * files on the agent filesystem, and the GitHub connections. Nothing outside
 * AgentOS is touched — the repositories stay on GitHub, and the App stays
 * installed until you uninstall it there.
 */
export function ProjectDanger({ project }: { project: ProjectDto }): React.JSX.Element {
  const [typed, setTyped] = useState("");
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { projects } = useProjects();

  const remove = useMutation({
    mutationFn: () => api.deleteProject(project.id),
    onSuccess: () => {
      // Move to whatever is left before the list refetches, so the app does not
      // spend a render pointed at a project that no longer exists.
      const next = projects.find((candidate) => candidate.id !== project.id);
      selectProject(next?.id ?? null);
      void queryClient.invalidateQueries();
    },
  });

  const armed = typed.trim() === project.slug;

  return (
    // White fill, red hairline, red glyph and a bordered red button. Never a
    // filled red slab: the one thing on this page that destroys work should not
    // also be the most attractive thing on it.
    <Panel className="border-danger-line">
      <PanelHeader className="border-b border-edge">
        <PanelTitle icon={<TriangleAlert />} className="[&_svg]:text-danger">
          Delete this project
        </PanelTitle>
      </PanelHeader>
      <div className="space-y-4 p-4">
        <p className="text-[13px] leading-relaxed text-ink-muted">
          Permanently deletes <span className="font-medium text-ink">{project.name}</span> and
          everything inside it. This cannot be undone and there is no export.
        </p>

        {/* Naming the rows rather than saying "all data": the operator is about
            to type a slug to confirm, and they deserve to know that the session
            history — the record of what was spent and why — goes with it. */}
        <Well className="space-y-2">
          <MicroLabel>What goes</MicroLabel>
          <p className="text-xs leading-relaxed text-ink-muted">
            Agents, tasks, goals, sessions and their history, templates, skills, repositories,
            MCP connections, environments, secret references, triggers, automations, and every
            file on the agent filesystem.
          </p>
          <MicroLabel>What stays</MicroLabel>
          <p className="text-xs leading-relaxed text-ink-muted">
            Nothing outside AgentOS is touched. Your repositories remain on GitHub, commits already
            pushed remain pushed, and the GitHub App stays installed until you remove it there.
          </p>
        </Well>

        <Field
          label="Confirm the slug"
          hint={
            <>
              Type <span className="machine text-ink">{project.slug}</span> to enable the button.
            </>
          }
          error={
            typed.trim().length > 0 && !armed ? "Enter the exact project slug." : undefined
          }
        >
          {(id) => (
            <Input
              id={id}
              className="machine max-w-xs"
              value={typed}
              autoComplete="off"
              spellCheck={false}
              placeholder={project.slug}
              onChange={(event) => setTyped(event.target.value)}
            />
          )}
        </Field>

        <FormActions
          message={
            remove.isError ? (
              <span className="text-danger">
                {remove.error instanceof ApiError
                  ? remove.error.message
                  : "Project deletion failed."}
              </span>
            ) : null
          }
        >
          <Button
            variant="danger"
            disabled={!armed || remove.isPending}
            onClick={() =>
              confirm({
                kind: "destroy",
                title: `Delete ${project.name}?`,
                body: <>All project data will be permanently deleted. No export or undo is available.</>,
                confirmLabel: "Delete project",
                onConfirm: () => remove.mutate(),
              })
            }
          >
            {remove.isPending ? "Deleting…" : "Delete project"}
          </Button>
        </FormActions>
      </div>
    </Panel>
  );
}
