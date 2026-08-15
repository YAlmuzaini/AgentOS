import { useQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { useActiveProject } from "../hooks/use-project";
import { AgentDetail } from "./agent-detail";
import { NoProject } from "./tasks";

/**
 * Agents are the thing this product is about, so this is a list beside a
 * detail rather than a table: the row is an index, and the panel beside it is
 * where the agent's grants — the whole least-privilege story — are readable.
 */
export function AgentsPage(): React.JSX.Element {
  const { project } = useActiveProject();
  const [selected, setSelected] = useState<string | null>(null);

  const agents = useQuery({
    queryKey: ["agents", project?.id],
    queryFn: () => api.agents(project!.id),
    enabled: Boolean(project),
  });

  if (!project) {
    return <NoProject />;
  }

  const list = agents.data ?? [];
  const active = selected ?? list[0]?.id ?? null;

  return (
    <Page fill>
      <PageHeader
        icon={<Bot />}
        title="Agents"
        meta={list.length > 0 ? `${list.length} configured` : undefined}
      />

      <div className="grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[280px_1fr]">
        <Panel className="h-fit overflow-hidden lg:flex lg:h-auto lg:min-h-0 lg:flex-col">
          {agents.isLoading ? (
            <SkeletonRows rows={6} />
          ) : list.length === 0 ? (
            <EmptyState
              icon={<Bot />}
              title="No agents configured"
              hint="Agents are declared in agentos.yml. Push the file and they appear here."
            />
          ) : (
            <ul className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              {list.map((agent) => (
                <li key={agent.id} className="border-b border-edge last:border-0">
                  <button
                    type="button"
                    className={`w-full px-3.5 py-2.5 text-left transition-colors ${
                      active === agent.id ? "bg-sunken" : "hover:bg-sunken/70"
                    }`}
                    onClick={() => setSelected(agent.id)}
                    aria-current={active === agent.id}
                  >
                    {/* No status pill here on purpose: nearly every agent has
                        inbox access, so a pill on every row is decoration. The
                        exception — an agent that cannot reach you — is the
                        thing worth marking. */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium text-ink">
                        {agent.title}
                      </span>
                      {agent.inboxAccess ? null : <StatusPill tone="neutral">no inbox</StatusPill>}
                    </div>
                    <div className="machine mt-0.5 truncate text-xs text-ink-muted">
                      {agent.name}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="min-w-0 lg:min-h-0 lg:overflow-y-auto">
          {active ? (
            <AgentDetail projectId={project.id} agentId={active} />
          ) : (
            <Panel>
              <EmptyState title="Select an agent" hint="Its grants and recent runs open here." />
            </Panel>
          )}
        </div>
      </div>

      <p className="shrink-0 text-xs text-ink-faint">
        Prompts, grants, and collaboration lists are edited in{" "}
        <span className="machine text-ink-muted">agentos.yml</span>: pull it, edit it, push it. That
        file is the source of truth, so editing an agent here would only drift from it.
      </p>
    </Page>
  );
}
