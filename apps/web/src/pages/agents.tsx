import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useActiveProject } from "../hooks/use-project";

export function AgentsPage(): React.JSX.Element {
  const { project } = useActiveProject();
  const agents = useQuery({
    queryKey: ["agents", project?.id],
    queryFn: () => api.agents(project!.id),
    enabled: Boolean(project),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Agents</h1>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
            <tr>
              <th className="py-2">Name</th>
              <th>Title</th>
              <th>Model</th>
              <th>Runner</th>
              <th>Inbox</th>
            </tr>
          </thead>
          <tbody>
            {(agents.data ?? []).map((agent) => (
              <tr key={agent.id} className="border-t border-edge">
                <td className="py-2 machine text-xs">{agent.name}</td>
                <td>{agent.title}</td>
                <td className="machine text-xs text-ink-muted">{agent.model}</td>
                <td className="text-ink-muted">{agent.runnerPreference}</td>
                <td className="text-ink-muted">{agent.inboxAccess ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {agents.data?.length === 0 ? (
          <p className="py-2 text-sm text-ink-muted">No agents configured for this project.</p>
        ) : null}
      </div>
      <p className="text-xs text-ink-faint">
        Prompts, grants, and collaboration lists are edited in agentos.yml: pull it, edit it, push
        it. That file is the source of truth, so editing an agent here would only drift from it.
      </p>
    </div>
  );
}
