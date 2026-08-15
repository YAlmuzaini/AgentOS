import { useQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { api } from "../api";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { Table, TableCard, TD, TH, THead, TR } from "../components/ui/table";
import { useActiveProject } from "../hooks/use-project";

export function AgentsPage(): React.JSX.Element {
  const { project } = useActiveProject();
  const agents = useQuery({
    queryKey: ["agents", project?.id],
    queryFn: () => api.agents(project!.id),
    enabled: Boolean(project),
  });

  const list = agents.data ?? [];

  return (
    <Page>
      <PageHeader
        icon={<Bot />}
        title="Agents"
        meta={list.length > 0 ? `${list.length} configured` : undefined}
      />

      {agents.isLoading ? (
        <Panel>
          <SkeletonRows />
        </Panel>
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Bot />}
            title="No agents configured"
            hint="Agents are declared in agentos.yml. Push the file and they appear here."
          />
        </Panel>
      ) : (
        <TableCard>
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Title</TH>
                <TH>Model</TH>
                <TH>Runner</TH>
                <TH>Inbox</TH>
              </tr>
            </THead>
            <tbody>
              {list.map((agent) => (
                <TR key={agent.id}>
                  <TD className="machine text-xs font-medium">{agent.name}</TD>
                  <TD>{agent.title}</TD>
                  <TD className="machine text-xs text-ink-muted">{agent.model}</TD>
                  <TD className="text-ink-muted">{agent.runnerPreference}</TD>
                  {/* Only the grant is worth a pill. "No inbox access" is the
                      default and the quiet case, so it stays plain text. */}
                  <TD>
                    {agent.inboxAccess ? (
                      <StatusPill tone="idle">can ask you</StatusPill>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableCard>
      )}

      <p className="text-xs text-ink-faint">
        Prompts, grants, and collaboration lists are edited in{" "}
        <span className="machine text-ink-muted">agentos.yml</span>: pull it, edit it, push it. That
        file is the source of truth, so editing an agent here would only drift from it.
      </p>
    </Page>
  );
}
