import type { AgentDto } from "@agentos/shared";
import { useQuery } from "@tanstack/react-query";
import { Blocks, Bot, FileText, FolderTree, GitBranch, Inbox, Pencil, Server, ShieldCheck, Sparkles, Users } from "lucide-react";
import type { ReactNode } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Panel, PanelHeader, PanelTitle, Well } from "../components/ui/panel";
import { Dot, StatusPill } from "../components/ui/pill";
import { describeRunner, GrantRow, Section } from "./agent-detail-parts";

/**
 * Everything the control plane knows about one agent, on one screen.
 *
 * The list only ever showed name, title, model, runner and inbox access — five
 * of the sixteen fields on AgentDto. The other eleven are the grants, and the
 * grants *are* the product: least privilege is only checkable if the operator
 * can see what an agent was actually given. `GET /agents/:id` already existed
 * and nothing called it.
 */
export function AgentDetail(props: {
  projectId: string;
  agentId: string;
  /** Opens the editor on this agent — the grants below are what it edits. */
  onEdit?: () => void;
}): React.JSX.Element {
  const agent = useQuery({
    queryKey: ["agent", props.projectId, props.agentId],
    queryFn: () => api.agent(props.projectId, props.agentId),
  });

  // The grant lists are ids; these turn them into the names an operator knows.
  const mcps = useQuery({
    queryKey: ["mcp-connections", props.projectId],
    queryFn: () => api.mcpConnections(props.projectId),
  });
  const skills = useQuery({
    queryKey: ["skills", props.projectId],
    queryFn: () => api.skills(props.projectId),
  });
  const repos = useQuery({
    queryKey: ["repos", props.projectId],
    queryFn: () => api.repos(props.projectId),
  });
  const environments = useQuery({
    queryKey: ["environments", props.projectId],
    queryFn: () => api.environments(props.projectId),
  });
  const sessions = useQuery({
    queryKey: ["sessions", props.projectId],
    queryFn: () => api.sessions(props.projectId),
    refetchInterval: 5000,
  });
  // An agent that inherits is showing the project's choice, not its own, and
  // "runs inherit" told the operator nothing about where their money goes.
  const settings = useQuery({
    queryKey: ["settings", props.projectId],
    queryFn: () => api.settings(props.projectId),
  });

  if (!agent.data) {
    return (
      <Panel>
        <SkeletonRows rows={6} />
      </Panel>
    );
  }

  const data = agent.data;
  const runs = (sessions.data ?? []).filter((session) => session.agentId === data.id);
  const environment = environments.data?.find((e) => e.id === data.environmentId);

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-4">
        <Panel>
          <div className="flex items-start gap-3 border-b border-edge p-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-control border border-edge bg-sunken text-ink-muted">
              <Bot className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-[15px] font-semibold text-ink">{data.title}</h2>
                {data.inboxAccess ? (
                  <StatusPill tone="idle">can ask you</StatusPill>
                ) : (
                  <StatusPill tone="neutral">no inbox</StatusPill>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                <span className="machine">{data.name}</span>
                <span aria-hidden className="text-edge-strong">
                  ·
                </span>
                <span className="machine">{data.model}</span>
                <span aria-hidden className="text-edge-strong">
                  ·
                </span>
                <span>
                  {runs.length} {runs.length === 1 ? "session" : "sessions"}
                </span>
                <span aria-hidden className="text-edge-strong">
                  ·
                </span>
                <span>{describeRunner(data.runnerPreference, settings.data?.defaultRunner)}</span>
              </div>
            </div>
            {/* The edit sits beside the grants it changes: this screen is where
                an operator reads what an agent may reach, so it is where they
                should be able to change it. */}
            {props.onEdit ? (
              <Button variant="ghost" size="sm" onClick={props.onEdit}>
                <Pencil />
                Edit
              </Button>
            ) : null}
          </div>

          <Section title="Role" icon={<FileText />}>
            <Well className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink">
              {data.rolePrompt || "No role prompt set."}
            </Well>
          </Section>

          {data.foundationalPrompt ? (
            <Section title="Foundational prompt" icon={<FileText />}>
              <Well className="max-h-56 overflow-auto">
                <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink-muted">
                  {data.foundationalPrompt}
                </p>
              </Well>
            </Section>
          ) : null}
        </Panel>

        {/*
          The four walls from PRODUCT.md, each rendered as what it actually
          grants. An empty list is the interesting case, not a gap: it means
          default-deny is holding.
        */}
        <Panel>
          <PanelHeader className="border-b border-edge">
            <PanelTitle icon={<ShieldCheck />}>Grants</PanelTitle>
            <span className="text-xs text-ink-faint">anything not listed is denied</span>
          </PanelHeader>

          <GrantRow
            icon={<Server />}
            label="Network"
            empty="No environment — this agent reaches no host."
            items={
              environment
                ? [
                    <span key="env" className="flex items-center gap-2">
                      {environment.name}
                      {/* `limited` is the allowlisted, safe mode; `open` is the
                          one that should catch the operator's eye. */}
                      <StatusPill tone={environment.networking === "limited" ? "live" : "danger"}>
                        {environment.networking}
                      </StatusPill>
                      {environment.allowedHosts.length > 0 ? (
                        <span className="machine text-xs text-ink-muted">
                          {environment.allowedHosts.join(", ")}
                        </span>
                      ) : null}
                    </span>,
                  ]
                : []
            }
          />

          <GrantRow
            icon={<Blocks />}
            label="MCP tools"
            empty="No MCP connections — this agent has no tools."
            items={data.mcpConnectionIds.map((id) => (
              <span key={id}>{mcps.data?.find((m) => m.id === id)?.name ?? id}</span>
            ))}
          />

          <GrantRow
            icon={<Sparkles />}
            label="Skills"
            empty="No skills attached."
            items={data.skillIds.map((id) => (
              <span key={id}>{skills.data?.find((s) => s.id === id)?.name ?? id}</span>
            ))}
          />

          <GrantRow
            icon={<GitBranch />}
            label="Repos"
            empty="No repo access."
            items={data.repoAccess.map((access) => (
              <span key={access.repoId} className="flex flex-wrap items-center gap-2">
                {repos.data?.find((r) => r.id === access.repoId)?.name ?? access.repoId}
                <span className="machine text-xs text-ink-muted">{access.mountPath}</span>
                <StatusPill tone={access.permissions === "git-read" ? "neutral" : "gate"}>
                  {access.permissions}
                </StatusPill>
              </span>
            ))}
          />

          <GrantRow
            icon={<FolderTree />}
            label="Filesystem"
            empty="No filesystem grants."
            items={data.filesystemGrants.map((grant) => (
              <span key={grant.folderPath} className="flex flex-wrap items-center gap-2">
                <span className="machine">{grant.folderPath}</span>
                <span className="text-xs text-ink-muted">
                  {[grant.canRead && "read", grant.canWrite && "write", grant.canDelete && "delete"]
                    .filter(Boolean)
                    .join(" · ") || "no access"}
                </span>
              </span>
            ))}
          />

          <GrantRow
            icon={<Users />}
            label="May spawn"
            empty="Cannot spawn any agent."
            items={data.collaborationList.map((name) => (
              <span key={name} className="machine">
                {name}
              </span>
            ))}
          />

          <GrantRow
            icon={<Inbox />}
            label="Inbox"
            empty="Cannot interrupt you — it fails instead of asking."
            items={data.inboxAccess ? [<span key="inbox">Can ask you a question</span>] : []}
            last
          />
        </Panel>
      </div>

      {/* The reference's Recent Activity rail, carrying this agent's own runs. */}
      <Panel className="h-fit">
        <PanelHeader className="border-b border-edge">
          <PanelTitle accent="sky">Recent sessions</PanelTitle>
        </PanelHeader>
        {runs.length === 0 ? (
          <EmptyState title="No sessions yet" hint="Assign it a task and it will appear here." />
        ) : (
          <ol className="relative space-y-4 p-4 before:absolute before:top-6 before:bottom-6 before:left-[19px] before:w-px before:bg-edge">
            {runs.slice(0, 12).map((session) => (
              <li key={session.id} className="relative pl-5">
                <Dot
                  tone={
                    session.status === "running"
                      ? "live"
                      : session.status === "failed"
                        ? "danger"
                        : "neutral"
                  }
                  pulse={session.status === "running"}
                  className="absolute top-1.5 left-0 ring-2 ring-panel"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="machine text-xs text-ink">{session.id.slice(0, 8)}</span>
                  <span className="text-xs text-ink-muted">{session.status}</span>
                </div>
                <div className="mt-0.5 text-xs text-ink-faint">
                  {session.startedAt.slice(0, 19).replace("T", " ")}
                  {session.costUsd != null ? ` · $${session.costUsd.toFixed(2)}` : ""}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
