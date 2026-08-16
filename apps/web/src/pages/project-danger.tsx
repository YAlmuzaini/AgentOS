import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProjectDto } from "@agentos/shared";
import { api, ApiError } from "../api";
import { Button } from "../components/ui/button";
import { useConfirm } from "../components/ui/confirm";
import { Input } from "../components/ui/form";
import { Panel, PanelHeader, PanelTitle } from "../components/ui/panel";
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
    <Panel className="border-danger-line">
      <PanelHeader className="border-b border-edge">
        <PanelTitle accent="amber">Delete this project</PanelTitle>
      </PanelHeader>
      <div className="space-y-3 p-4">
        <p className="text-[13px] leading-relaxed text-ink-muted">
          Deletes every agent, task, goal, session, repository, secret reference, and file in{" "}
          <span className="font-medium text-ink">{project.name}</span>. Your repositories on GitHub
          are not touched. This cannot be undone.
        </p>
        <label className="block text-[13px] text-ink-muted" htmlFor="confirm-slug">
          Type <span className="machine text-ink">{project.slug}</span> to enable the button.
        </label>
        <Input
          id="confirm-slug"
          className="machine max-w-xs"
          value={typed}
          autoComplete="off"
          onChange={(event) => setTyped(event.target.value)}
        />
        <div className="flex items-center gap-3">
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
          {remove.isError ? (
            <span className="text-[13px] text-danger">
              {remove.error instanceof ApiError ? remove.error.message : "Project deletion failed."}
            </span>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
