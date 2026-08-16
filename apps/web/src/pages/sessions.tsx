import type { SessionDto, ToolCallLogEntry } from "@agentos/shared";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useActiveProject } from "../hooks/use-project";
import { useUrlSelection } from "../hooks/use-url-selection";
import { useLiveSession } from "./use-live-session";
import { ExternalLink, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { EmptyState, InlineError, SkeletonRows } from "../components/ui/feedback";
import { Page, PageHeader } from "../components/ui/page";
import { Panel, PanelHeader, PanelTitle, SectionLabel, Well } from "../components/ui/panel";
import { exactTime, Time } from "../components/ui/time";
import { SessionAccessPanel } from "./session-access";
import { Dot, StatusPill } from "../components/ui/pill";

/**
 * Every session status gets a tone. `starting` and `committing` are in flight
 * as much as `running` is — they used to fall through to neutral, so a session
 * mid-commit looked as settled as one destroyed an hour ago.
 */
function toneFor(status: SessionDto["status"] | undefined) {
  switch (status) {
    case "starting":
    case "running":
    case "committing":
      return "live" as const;
    case "waiting-inbox":
      return "gate" as const;
    case "failed":
      return "danger" as const;
    default:
      return "neutral" as const;
  }
}

/**
 * Whether this session left something behind.
 *
 * A destroy that failed keeps the status `destroyed` and records the reason on
 * the row, because the run really did end — but the container did not, and it
 * bills until someone reclaims it. Reading the status alone made the most
 * expensive outcome in the system look like the ordinary one.
 */
function leftContainerBehind(session: Pick<SessionDto, "status" | "error">): boolean {
  return session.status === "destroyed" && Boolean(session.error);
}

/** True while the session is still doing something worth watching. */
function isInFlight(status: SessionDto["status"] | undefined): boolean {
  return status === "starting" || status === "running" || status === "committing";
}

export function SessionsPage(): React.JSX.Element {
  // The URL is the selection; a click overrides it until the URL moves again.
  const { id: idFromUrl } = useSearch({ strict: false }) as { id?: string };
  const [selected, setSelected] = useUrlSelection(idFromUrl);
  // Scoped to the project on screen — the spend total below sums this list, and
  // a figure that quietly included another project's runs is the kind of number
  // an operator makes a decision on.
  const { project } = useActiveProject();
  const projectId = project?.id;
  const sessions = useQuery({
    queryKey: ["sessions", projectId],
    queryFn: () => api.sessions(projectId),
    enabled: Boolean(projectId),
    refetchInterval: 4000,
  });
  const detail = useQuery({
    queryKey: ["session", selected],
    queryFn: () => api.session(selected!),
    enabled: Boolean(selected),
    refetchInterval: 2000,
  });

  const live = useLiveSession(selected, detail.data?.status);
  const status = live.status ?? detail.data?.status;
  const entries = live.entries ?? detail.data?.toolCallLog ?? [];
  const list = sessions.data ?? [];
  const running = list.filter((session) => session.status === "running").length;
  const totalSpend = list.reduce((sum, session) => sum + (Number(session.costUsd) || 0), 0);

  return (
    <Page fill>
      {/* The running count lives in the top bar, where it is true of the whole
          control plane. Repeating it here said the same thing twice. */}
      <PageHeader
        icon={<Terminal />}
        title="Sessions"
        meta={list.length > 0 ? `${list.length} total` : undefined}
        actions={
          totalSpend > 0 ? (
            <StatusPill tone="neutral">${totalSpend.toFixed(2)} spent</StatusPill>
          ) : null
        }
      />

      <div className="grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[300px_1fr]">
        {/* The list scrolls inside its own panel: a seeded database returns 32
            sessions, and a list that grows the page takes the detail pane it
            is meant to be driving off the bottom of the screen. */}
        <Panel className="h-fit overflow-hidden lg:flex lg:h-auto lg:min-h-0 lg:flex-col">
          {sessions.isLoading ? (
            <SkeletonRows rows={5} />
          ) : list.length === 0 ? (
            <EmptyState icon={<Terminal />} title="No sessions yet" hint="Run a task." />
          ) : (
            <ul className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              {list.map((session) => (
                <li key={session.id} className="border-b border-edge last:border-0">
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition-colors ${
                      selected === session.id ? "bg-sunken" : "hover:bg-sunken/70"
                    }`}
                    onClick={() => setSelected(session.id)}
                    aria-current={selected === session.id}
                  >
                    <Dot
                      tone={leftContainerBehind(session) ? "danger" : toneFor(session.status)}
                      pulse={isInFlight(session.status)}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="machine truncate text-xs text-ink">
                        {session.agentName ?? session.id.slice(0, 8)}
                      </span>
                      {/* When, on the row: the list is how an operator finds
                          the run they are thinking of, and "which one was
                          this morning" is the question they arrive with. */}
                      <Time iso={session.startedAt} className="text-ink-faint" />
                    </span>
                    {/* What the run cost, where the operator is choosing which
                        run to open. It was recorded on every session and shown
                        nowhere. */}
                    {session.costUsd != null ? (
                      <span className="tnum shrink-0 text-xs text-ink-faint">
                        ${session.costUsd.toFixed(2)}
                      </span>
                    ) : null}
                    <span
                      className={
                        leftContainerBehind(session)
                          ? "shrink-0 text-xs text-danger"
                          : "shrink-0 text-xs text-ink-muted"
                      }
                      title={leftContainerBehind(session) ? (session.error ?? undefined) : undefined}
                    >
                      {leftContainerBehind(session) ? "not released" : session.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="min-w-0 lg:flex lg:min-h-0 lg:flex-col">
          <PanelHeader className="shrink-0 border-b border-edge">
            <PanelTitle accent="sky" icon={<Terminal />}>
              Tool calls
            </PanelTitle>
            <div className="flex items-center gap-2">
              {detail.data?.traceUrl ? (
                <a
                  className="inline-flex items-center gap-1 text-xs text-link hover:underline"
                  href={detail.data.traceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  runtime trace
                  <ExternalLink className="size-3" />
                </a>
              ) : null}
              {/* Cost, runner and commits for the open session: all recorded,
                  none of it previously rendered anywhere. */}
              {detail.data?.costUsd != null ? (
                <StatusPill tone="neutral">${detail.data.costUsd.toFixed(2)}</StatusPill>
              ) : null}
              {detail.data?.runner ? (
                <StatusPill tone="neutral">{detail.data.runner}</StatusPill>
              ) : null}
              {(detail.data?.commitShas ?? []).length > 0 ? (
                <StatusPill
                  tone="idle"
                  title={(detail.data?.commitShas ?? []).join("\n")}
                >
                  {detail.data!.commitShas.length} commit
                  {detail.data!.commitShas.length === 1 ? "" : "s"}
                </StatusPill>
              ) : null}
              {status ? (
                <StatusPill
                  tone={toneFor(status)}
                  dot={isInFlight(status)}
                  pulse={isInFlight(status)}
                >
                  {live.connected ? "live · " : ""}
                  {status}
                </StatusPill>
              ) : null}
            </div>
          </PanelHeader>

          {detail.data ? (
            <div className="shrink-0 border-b border-edge">
              <SessionAccessPanel session={detail.data} entries={entries} />
            </div>
          ) : null}

          {/* What the run left behind. A commit is the one thing that outlives
              the container, so it belongs on the row rather than in a title. */}
          {(detail.data?.commitShas ?? []).length > 0 ? (
            <div className="shrink-0 border-b border-edge px-4 py-3">
              <SectionLabel>Commits</SectionLabel>
              <ul className="machine mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
                {(detail.data?.commitShas ?? []).map((sha) => (
                  <li key={sha} title={sha}>
                    {sha.slice(0, 12)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {!selected ? (
              <EmptyState title="Select a session" hint="Its tool calls stream in here." />
            ) : entries.length === 0 ? (
              <EmptyState title="No tool calls logged yet" />
            ) : (
              <Well className="overflow-auto p-0">
                <ol className="machine divide-y divide-edge text-xs">
                  {entries.map((entry, index) => (
                    <li
                      key={`${entry.eventId ?? index}`}
                      className="flex gap-2.5 px-3.5 py-1.5 leading-relaxed"
                    >
                      <span className="shrink-0 text-ink-faint" title={exactTime(entry.at)}>
                        {entry.at.slice(11, 19)}
                      </span>
                      <span className="shrink-0 font-medium text-ink">
                        {entry.name ?? entry.type}
                      </span>
                      <span className="min-w-0 text-ink-muted">{entry.summary}</span>
                    </li>
                  ))}
                </ol>
              </Well>
            )}

            {detail.data?.error ? (
              <InlineError className="mt-3">{detail.data.error}</InlineError>
            ) : null}
          </div>
        </Panel>
      </div>
    </Page>
  );
}


/**
 * Streams the live session viewer while a session is running.
 *
 * Uses fetch rather than EventSource on purpose: EventSource cannot send an
 * Authorization header, and putting the operator token in the URL would leak
 * it into server logs, browser history and referrers. If the stream fails the
 * component keeps its 2s poll, which is what makes this safe behind a proxy
 * that buffers server-sent events.
 */
