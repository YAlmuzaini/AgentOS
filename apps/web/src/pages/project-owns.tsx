import { useQueries } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../api";
import { Panel, PanelHeader, PanelTitle } from "../components/ui/panel";

/**
 * Everything that switching projects replaces.
 *
 * The rail already implies this, but implication is what left the operator
 * unsure which screens were about *this* project and which were about the
 * installation. Counting the real rows says it without a diagram: these are the
 * eleven things a project owns, here is how many of each you have, and none of
 * them are visible from any other project.
 *
 * The counts come from the same query keys the pages use, so this panel is free
 * on a warm cache and never disagrees with the page it links to.
 */
const OWNED = [
  { to: "/agents", label: "Agents", key: "agents", load: api.agents },
  { to: "/templates", label: "Templates", key: "templates", load: api.templates },
  { to: "/skills", label: "Skills", key: "skills", load: api.skills },
  { to: "/tasks", label: "Tasks", key: "tasks", load: api.tasks },
  { to: "/goals", label: "Goals", key: "goals", load: api.goals },
  { to: "/repos", label: "Repositories", key: "repos", load: api.repos },
  { to: "/mcps", label: "MCP connections", key: "mcpConnections", load: api.mcpConnections },
  { to: "/environment", label: "Environments", key: "environments", load: api.environments },
  { to: "/secrets", label: "Secrets", key: "secrets", load: api.secrets },
  { to: "/triggers", label: "Triggers", key: "triggers", load: api.triggers },
  { to: "/automations", label: "Automations", key: "automations", load: api.automations },
] as const;

export function ProjectOwns({ projectId }: { projectId: string }): React.JSX.Element {
  const results = useQueries({
    queries: OWNED.map((entry) => ({
      queryKey: [entry.key, projectId],
      queryFn: () => entry.load(projectId) as Promise<unknown[]>,
    })),
  });

  return (
    <Panel>
      <PanelHeader className="border-b border-edge">
        <PanelTitle accent="violet">Project resources</PanelTitle>
      </PanelHeader>
      <div className="space-y-4 p-4">
        <p className="text-[13px] leading-relaxed text-ink-muted">
          Switching projects replaces every row below. An agent here cannot be granted a repo, a
          secret or a file belonging to another project: every grant is resolved inside the agent's
          own project, so a stray id resolves to nothing rather than to someone else's credential.
        </p>

        {/* One column: this panel lives in a 360px rail, and two columns of
            eleven short rows there wraps the longer labels. */}
        <ul className="grid gap-px overflow-hidden rounded-control border border-edge bg-edge">
          {OWNED.map((entry, index) => {
            const result = results[index]!;
            return (
              <li key={entry.key}>
                <Link
                  to={entry.to}
                  className="flex items-baseline justify-between gap-3 bg-panel px-3 py-2 transition-colors hover:bg-sunken"
                >
                  <span className="text-[13px] text-ink">{entry.label}</span>
                  <span className="tnum text-[13px] text-ink-faint">
                    {result.isPending ? "—" : ((result.data as unknown[] | undefined)?.length ?? 0)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="text-xs leading-relaxed text-ink-faint">
          Sessions, activity, the inbox and the agent filesystem are project-scoped too — they are
          records of the rows above rather than things you create.
        </p>
      </div>
    </Panel>
  );
}
