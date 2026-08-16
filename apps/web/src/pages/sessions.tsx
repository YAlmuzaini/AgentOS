import type { SessionDto, ToolCallLogEntry } from "@agentos/shared";
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useActiveProject } from "../hooks/use-project";
import { useUrlSelection } from "../hooks/use-url-selection";
import { useLiveSession } from "./use-live-session";
import { ExternalLink, Terminal } from "lucide-react";
import { api, ApiError } from "../api";
import { DeleteAction } from "../components/ui/delete-action";
import { EmptyState, InlineError, SkeletonRows } from "../components/ui/feedback";
import { Page, PageHeader } from "../components/ui/page";
import { Panel, PanelHeader, PanelTitle, SectionLabel, Well } from "../components/ui/panel";
import { exactTime, Time } from "../components/ui/time";
import { SessionAccessPanel } from "./session-access";
import { CountChip, Dot, StatusPill } from "../components/ui/pill";
import { truncate } from "./dashboard-figures";

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

/**
 * The result state of one log entry, as a tone for its marker.
 *
 * The consumer writes three shapes an operator cares about (see
 * `session-consumer.ts`): a `session.error`, a tool call that parked on the
 * operator, and everything else. Reading the log as an undifferentiated column
 * of grey text meant the one line that says why a run died sat between four
 * hundred that say what it read.
 */
function entryTone(entry: ToolCallLogEntry): "danger" | "gate" | "neutral" {
  if (entry.type === "session.error") {
    return "danger";
  }
  if (entry.summary.startsWith("parked")) {
    return "gate";
  }
  return "neutral";
}

/** The status word on a row, tinted only when the status is worth a colour. */
function statusTextClass(tone: ReturnType<typeof toneFor>): string {
  switch (tone) {
    case "danger":
      return "text-danger";
    case "gate":
      return "text-gate";
    default:
      return "text-ink-muted";
  }
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
        meta={list.length > 0 ? <CountChip>{list.length}</CountChip> : undefined}
        actions={
          totalSpend > 0 ? (
            <StatusPill tone="neutral" className="tnum">
              ${totalSpend.toFixed(2)} spent
            </StatusPill>
          ) : null
        }
      />

      {/* A list that cannot be fetched is not an empty one, and "no sessions
          yet" would tell the operator their runs are gone. */}
      {sessions.isError ? (
        <InlineError>
          {sessions.error instanceof ApiError ? sessions.error.message : "Unable to load sessions."}
        </InlineError>
      ) : null}

      <div className="grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[300px_1fr]">
        {/* The list scrolls inside its own panel: a seeded database returns 32
            sessions, and a list that grows the page takes the detail pane it
            is meant to be driving off the bottom of the screen. */}
        <Panel className="h-fit overflow-hidden lg:flex lg:h-auto lg:min-h-0 lg:flex-col">
          {sessions.isLoading ? (
            <SkeletonRows rows={5} />
          ) : list.length === 0 ? (
            <EmptyState
              icon={<Terminal />}
              title="No sessions yet"
              hint="A session is the record of one agent run. Assign a task to an agent and one will appear here."
            />
          ) : (
            <ul className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              {list.map((session) => {
                const tone = leftContainerBehind(session) ? "danger" : toneFor(session.status);
                return (
                  <li key={session.id} className="border-b border-edge last:border-0">
                    <button
                      type="button"
                      title={session.id}
                      className={`flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition-colors ${
                        selected === session.id ? "bg-sunken" : "hover:bg-sunken/70"
                      }`}
                      onClick={() => setSelected(session.id)}
                      aria-current={selected === session.id}
                    >
                      {/* The one repeating animation in the app, and it earns
                          it: a run in flight is the difference between a live
                          screen and a stale screenshot. Nothing finished, and
                          nothing failed, pulses. */}
                      <Dot tone={tone} pulse={isInFlight(session.status)} />
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
                          nowhere. A run with nothing recorded shows nothing
                          rather than a $0.00 it did not earn. */}
                      {session.costUsd != null ? (
                        <span className="tnum shrink-0 text-xs text-ink-faint">
                          ${session.costUsd.toFixed(2)}
                        </span>
                      ) : null}
                      <span
                        className={`shrink-0 text-xs ${
                          leftContainerBehind(session) ? "text-danger" : statusTextClass(tone)
                        }`}
                        title={
                          leftContainerBehind(session) ? (session.error ?? undefined) : undefined
                        }
                      >
                        {leftContainerBehind(session) ? "container active" : session.status}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel className="min-w-0 lg:flex lg:min-h-0 lg:flex-col">
          <PanelHeader className="shrink-0 border-b border-edge">
            <PanelTitle accent="sky" icon={<Terminal />}>
              Tool calls
            </PanelTitle>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {detail.data?.traceUrl ? (
                <a
                  className="inline-flex items-center gap-1 rounded-control text-xs text-link transition-colors hover:underline"
                  href={detail.data.traceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  View runtime trace
                  <ExternalLink className="size-3" />
                </a>
              ) : null}
              {/* Only once the run is over: the row is the only handle the
                  control plane has on a live container, and the server refuses
                  it anyway. */}
              {selected && detail.data && !isInFlight(detail.data.status) ? (
                <DeleteAction
                  what="this session"
                  label="Delete"
                  body={
                    <>
                      This deletes the tool-call log, cost, and commit record. The completed runtime
                      container is not affected.
                    </>
                  }
                  onDelete={async () => {
                    await api.deleteSession(selected);
                    setSelected(null);
                  }}
                  invalidate={[["sessions", projectId]]}
                />
              ) : null}
              {/* Cost, runner and commits for the open session: all recorded,
                  none of it previously rendered anywhere. */}
              {detail.data?.costUsd != null ? (
                <StatusPill tone="neutral" className="tnum" title="What this run cost">
                  ${detail.data.costUsd.toFixed(2)}
                </StatusPill>
              ) : null}
              {detail.data?.runner ? (
                <StatusPill tone="neutral" title="The backend this session ran on">
                  <span className="machine">{detail.data.runner}</span>
                </StatusPill>
              ) : null}
              {(detail.data?.commitShas ?? []).length > 0 ? (
                <StatusPill
                  tone="idle"
                  className="tnum"
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

          <div className="flex flex-col gap-3 p-4 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
            {/* A detail fetch that failed leaves the pane looking like a session
                with nothing in it, which is the same picture as a run that did
                nothing at all. */}
            {selected && detail.isError ? (
              <InlineError>
                {detail.error instanceof ApiError
                  ? detail.error.message
                  : "Unable to load this session."}
              </InlineError>
            ) : null}

            {!selected ? (
              <EmptyState title="Select a session" hint="View its access details and tool-call log." />
            ) : entries.length === 0 ? (
              <EmptyState
                title="No tool calls recorded"
                hint="No control-plane tool calls were recorded. Check the runtime trace for additional activity."
              />
            ) : (
              /*
               * The audit trail of what the agent actually reached for. It has
               * to stay readable at four hundred entries, so it scrolls inside
               * this well rather than growing the pane: it is one column of
               * fixed-width stamps, one of tool names, and a result that
               * truncates. A single 20KB log line used to widen the sheet and
               * put the session list off the side of the screen.
               */
              <Well className="max-h-[60vh] overflow-y-auto p-0 lg:max-h-none lg:min-h-0 lg:flex-1">
                <ol className="divide-y divide-edge text-xs">
                  {entries.map((entry, index) => {
                    const tone = entryTone(entry);
                    return (
                      <li
                        key={`${entry.eventId ?? index}`}
                        className="flex items-baseline gap-2.5 px-3.5 py-1.5 leading-relaxed"
                      >
                        {/* The quiet marker: only an error and a park get one,
                            so the eye lands on the two lines that matter. */}
                        <Dot
                          tone={tone}
                          className={tone === "neutral" ? "opacity-0" : undefined}
                        />
                        <span
                          className="machine tnum shrink-0 text-ink-faint"
                          title={exactTime(entry.at)}
                        >
                          {entry.at.slice(11, 19)}
                        </span>
                        <span className="machine shrink-0 font-medium text-ink">
                          {entry.name ?? entry.type}
                        </span>
                        <span
                          className={`machine min-w-0 flex-1 truncate ${
                            tone === "danger" ? "text-danger" : "text-ink-muted"
                          }`}
                          title={truncate(entry.summary, 400)}
                        >
                          {entry.summary}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </Well>
            )}

            {detail.data?.error ? <InlineError>{detail.data.error}</InlineError> : null}
          </div>
        </Panel>
      </div>
    </Page>
  );
}
