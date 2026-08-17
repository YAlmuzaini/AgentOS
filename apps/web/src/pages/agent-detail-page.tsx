import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Bot, Plus } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { Page, PageHeader } from "../components/ui/page";
import { useProjectGate } from "../hooks/use-project";
import { AgentDetail } from "./agent-detail";
import { AgentForm } from "./agent-form";
import { NoProject, ProjectPending } from "./project-states";

/**
 * One agent at its own address.
 *
 * The screen this replaces was the index rendering a detail instead of a grid
 * when `?id=` was set. That made one route mean two things: the back button had
 * to re-mount the whole library to leave an agent, the browser could not tell
 * the two apart in history, and the address of an agent read like a filter on
 * the list. Splitting them costs nothing at the API — this screen calls exactly
 * the endpoints the embedded one did.
 *
 * The title comes from `AgentDetail`'s own query, so this component does not
 * fetch the agent twice; until it lands the crumb reads "Agent", which is true
 * and short rather than a skeleton the eye has to wait on.
 */
export function AgentDetailPage(): React.JSX.Element {
  const { project, pending, absent } = useProjectGate();
  const { agentId } = useParams({ from: "/agents/$agentId" });
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  // The same key `AgentDetail` uses, so this is a cache read and not a second
  // request — it is here for the crumb title and for what the editor loads.
  const agent = useQuery({
    queryKey: ["agent", project?.id, agentId],
    queryFn: () => api.agent(project!.id, agentId),
    enabled: Boolean(project),
  });

  if (absent) {
    return <NoProject />;
  }
  if (pending || !project) {
    return <ProjectPending />;
  }

  const toIndex = (): void => void navigate({ to: "/agents" });

  return (
    <Page>
      <PageHeader
        icon={<Bot />}
        parent={{ label: "Agents", onClick: toIndex }}
        title={agent.data?.title ?? "Agent"}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus />
            New agent
          </Button>
        }
      />

      <AgentForm
        key={editing ? `edit:${agentId}` : "new"}
        projectId={project.id}
        agent={editing ? agent.data : undefined}
        open={creating || editing}
        onClose={() => {
          setCreating(false);
          setEditing(false);
        }}
      />

      <AgentDetail
        projectId={project.id}
        agentId={agentId}
        onEdit={() => setEditing(true)}
        onDeleted={toIndex}
      />
    </Page>
  );
}
