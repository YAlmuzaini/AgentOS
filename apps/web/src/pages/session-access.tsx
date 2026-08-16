import type { SessionAccess, SessionDto, ToolCallLogEntry } from "@agentos/shared";
import { Boxes, FolderTree, GitBranch, KeyRound, Network, Plug, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { SectionLabel, Well } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { Duration, Time } from "../components/ui/time";

/**
 * What this session was given, and what it did with it (SPEC §13).
 *
 * The session screen could say what a run *did* and never what it *could have
 * done*, which is the half that matters when the question is "why did it not
 * find the repo" or "how did it reach that host". Read from the record made at
 * provision, so an agent edited since does not rewrite its own history.
 */
export function SessionAccessPanel(props: {
  session: SessionDto;
  entries: ToolCallLogEntry[];
}): React.JSX.Element {
  const access = props.session.access;
  const used = toolUsage(props.entries);

  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Well className="space-y-1.5">
          <SectionLabel>Ran</SectionLabel>
          <dl className="space-y-1 text-[13px]">
            <Row label="Agent">
              <span className="machine text-xs">{props.session.agentName ?? "—"}</span>
            </Row>
            <Row label="Model">
              <span className="machine text-xs">{access?.model || "—"}</span>
            </Row>
            <Row label="Backend">{props.session.runner}</Row>
            {/* The id is what correlates this run with a provider console, a
                log line, or a bill, so it belongs where it can be copied. */}
            <Row label="Session">
              <span className="machine text-xs" title={props.session.id}>
                {props.session.id.slice(0, 8)}
              </span>
            </Row>
            <Row label="Started">
              <Time iso={props.session.startedAt} absolute />
            </Row>
            <Row label={props.session.endedAt ? "Ended" : "Running for"}>
              {props.session.endedAt ? (
                <Time iso={props.session.endedAt} absolute />
              ) : (
                <Duration startedAt={props.session.startedAt} className="text-xs" />
              )}
            </Row>
            {props.session.endedAt ? (
              <Row label="Took">
                <Duration
                  startedAt={props.session.startedAt}
                  endedAt={props.session.endedAt}
                  className="text-xs"
                />
              </Row>
            ) : null}
          </dl>
        </Well>

        <Well className="space-y-1.5">
          <SectionLabel>Could reach</SectionLabel>
          {access ? (
            <dl className="space-y-1 text-[13px]">
              <Row label="Network" icon={<Network />}>
                {access.networking === "open" ? (
                  <span className="machine text-xs">unrestricted — any host</span>
                ) : access.allowedHosts.length > 0 ? (
                  <span className="machine text-xs">{access.allowedHosts.join(", ")}</span>
                ) : (
                  <span className="text-ink-muted">nothing</span>
                )}
              </Row>
              <Row label="MCP" icon={<Plug />}>
                {access.mcpServers.length > 0
                  ? access.mcpServers
                      .map((server) =>
                        server.allowedOperations.length > 0
                          ? `${server.name} (${server.allowedOperations.join(", ")})`
                          : server.name,
                      )
                      .join(", ")
                  : none()}
              </Row>
              <Row label="Repositories" icon={<GitBranch />}>
                {access.repos.length > 0
                  ? access.repos.map((repo) => `${repo.name} · ${repo.permissions}`).join(", ")
                  : none()}
              </Row>
              <Row label="Env vars" icon={<KeyRound />}>
                {/* Keys only — a value here would be a credential on a screen. */}
                {access.envVarKeys.length > 0 ? (
                  <span className="machine text-xs">{access.envVarKeys.join(", ")}</span>
                ) : (
                  none()
                )}
              </Row>
              <Row label="Folders" icon={<FolderTree />}>
                {access.folders.length > 0 ? (
                  <span className="machine text-xs">{access.folders.join("  ·  ")}</span>
                ) : (
                  none()
                )}
              </Row>
              <Row label="May spawn" icon={<Boxes />}>
                {access.collaborators.length > 0 ? access.collaborators.join(", ") : none()}
              </Row>
            </dl>
          ) : (
            <p className="text-[13px] text-ink-faint">
              This session ran before AgentOS recorded what it was granted.
            </p>
          )}
        </Well>
      </div>

      <div className="space-y-2">
        <SectionLabel>
          Tools {used.total > 0 ? `· ${used.total} call${used.total === 1 ? "" : "s"}` : ""}
        </SectionLabel>
        {access && access.tools.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {access.tools.map((tool) => {
              const count = used.byName.get(tool) ?? 0;
              return (
                <StatusPill key={tool} tone="neutral" title={toolTitle(count)}>
                  <span className={count > 0 ? "machine text-ink" : "machine text-ink-faint"}>
                    {tool}
                  </span>
                  {count > 0 ? <span className="tnum"> ×{count}</span> : null}
                </StatusPill>
              );
            })}
          </div>
        ) : (
          <p className="text-[13px] text-ink-faint">
            <Wrench className="mr-1 inline size-3.5" />
            No tool list recorded for this session.
          </p>
        )}
        {/* Anything the agent called that is not a control-plane tool — the
            runtime's own shell, editor and search. Counted, because "what did
            it actually do" is the question this screen exists to answer. */}
        {used.other.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {used.other.map(([name, count]) => (
              <StatusPill key={name} tone="neutral" title="the runtime's own toolset">
                <span className="machine">{name}</span>
                <span className="tnum"> ×{count}</span>
              </StatusPill>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function toolTitle(count: number): string {
  return count > 0 ? `called ${count} time${count === 1 ? "" : "s"}` : "granted, never called";
}

function none(): React.JSX.Element {
  return <span className="text-ink-faint">none</span>;
}

function Row(props: { label: string; icon?: ReactNode; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="flex w-24 shrink-0 items-center gap-1.5 text-ink-muted [&_svg]:size-3 [&_svg]:text-ink-faint">
        {props.icon}
        {props.label}
      </dt>
      <dd className="min-w-0 flex-1 break-words text-ink">{props.children}</dd>
    </div>
  );
}

/**
 * How often each tool was called, from the log the viewer already has.
 *
 * Derived rather than counted at write time: the log is the record, and a
 * second counter would be a second thing to keep true.
 */
function toolUsage(entries: ToolCallLogEntry[]): {
  total: number;
  byName: Map<string, number>;
  other: Array<[string, number]>;
} {
  const byName = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.name) {
      continue;
    }
    byName.set(entry.name, (byName.get(entry.name) ?? 0) + 1);
  }
  const controlPlane = (name: string) =>
    name.startsWith("agentos_") || name.startsWith("fs_") || name.startsWith("inbox_");
  return {
    total: [...byName.values()].reduce((sum, count) => sum + count, 0),
    byName,
    other: [...byName.entries()].filter(([name]) => !controlPlane(name)),
  };
}
