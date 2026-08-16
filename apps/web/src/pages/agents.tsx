import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Download, Plus } from "lucide-react";
import { useSearch } from "@tanstack/react-router";
import { useUrlSelection } from "../hooks/use-url-selection";
import { useState } from "react";
import { api } from "../api";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { useProjectGate } from "../hooks/use-project";
import { Button } from "../components/ui/button";
import { AgentDetail } from "./agent-detail";
import { AgentForm } from "./agent-form";
import { NoProject, ProjectPending } from "./project-states";

/**
 * Agents are the thing this product is about, so this is a list beside a
 * detail rather than a table: the row is an index, and the panel beside it is
 * where the agent's grants — the whole least-privilege story — are readable.
 */
export function AgentsPage(): React.JSX.Element {
  const { project, pending, absent } = useProjectGate();
  const queryClient = useQueryClient();
  // The URL is the selection; a click overrides it until the URL moves again.
  const { id: idFromUrl } = useSearch({ strict: false }) as { id?: string };
  const [selected, setSelected] = useUrlSelection(idFromUrl);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const agents = useQuery({
    queryKey: ["agents", project?.id],
    queryFn: () => api.agents(project!.id),
    enabled: Boolean(project),
  });

  // Above the project guards: every hook has to run on every render, and the
  // guards below return early.
  const installBuiltIns = useMutation({
    mutationFn: () => api.installBuiltInAgents(project!.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agents", project?.id] }),
  });

  if (absent) {
    return <NoProject />;
  }
  if (pending || !project) {
    return <ProjectPending />;
  }


  const list = agents.data ?? [];
  const active = selected ?? list[0]?.id ?? null;
  const activeAgent = list.find((agent) => agent.id === active);

  return (
    <Page fill>
      <PageHeader
        icon={<Bot />}
        title="Agents"
        meta={list.length > 0 ? `${list.length} configured` : undefined}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus />
            New agent
          </Button>
        }
      />

      <AgentForm
        key={editingId ?? "new"}
        projectId={project.id}
        agent={editingId ? list.find((agent) => agent.id === editingId) : undefined}
        open={creating || Boolean(editingId)}
        onClose={() => {
          setCreating(false);
          setEditingId(null);
        }}
      />

      <div className="grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[280px_1fr]">
        <Panel className="h-fit overflow-hidden lg:flex lg:h-auto lg:min-h-0 lg:flex-col">
          {agents.isLoading ? (
            <SkeletonRows rows={6} />
          ) : list.length === 0 ? (
            <EmptyState
              icon={<Bot />}
              title="No agents configured"
              hint="Install the built-in roles, create one here, or declare a fleet in agentos.yml and push it."
              action={
                <Button
                  variant="solid"
                  onClick={() => installBuiltIns.mutate()}
                  disabled={installBuiltIns.isPending}
                >
                  <Download />
                  Install built-ins
                </Button>
              }
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
            <AgentDetail
              projectId={project.id}
              agentId={active}
              onEdit={() => setEditingId(active)}
            />
          ) : (
            <Panel>
              <EmptyState title="Select an agent" hint="Its grants and recent runs open here." />
            </Panel>
          )}
        </div>
      </div>

      {/* The old note here said agents were edited in YAML and that editing
          them on this screen would drift from it. Both halves were wrong: the
          database is what a session actually reads, and this screen now writes
          to it. What is worth saying is the one direction that really does
          overwrite work — pushing a file that was exported before these edits. */}
      <p className="shrink-0 text-xs text-ink-faint">
        Edits here take effect on the next session.{" "}
        <span className="machine text-ink-muted">agentos.yml</span> is for authoring a fleet in
        version control — <span className="machine text-ink-muted">push</span> applies a file to
        this project and <span className="machine text-ink-muted">pull</span> exports what is here,
        so pull before you push if you have changed anything on this screen.
      </p>
    </Page>
  );
}
