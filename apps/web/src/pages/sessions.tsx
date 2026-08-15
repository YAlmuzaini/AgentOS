import type { SessionDto, ToolCallLogEntry } from "@agentos/shared";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { api, BASE, getToken } from "../api";
import { EmptyState, InlineError, SkeletonRows } from "../components/ui/feedback";
import { Page, PageHeader } from "../components/ui/page";
import { Panel, PanelHeader, PanelTitle, Well } from "../components/ui/panel";
import { Dot, StatusPill } from "../components/ui/pill";

/** One tone per session state. `running` is the only thing that pulses. */
function toneFor(status: SessionDto["status"] | undefined) {
  switch (status) {
    case "running":
      return "live" as const;
    case "waiting-inbox":
      return "gate" as const;
    case "failed":
      return "danger" as const;
    default:
      return "neutral" as const;
  }
}

export function SessionsPage(): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null);
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: api.sessions,
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

  return (
    <Page>
      {/* The running count lives in the top bar, where it is true of the whole
          control plane. Repeating it here said the same thing twice. */}
      <PageHeader
        icon={<Terminal />}
        title="Sessions"
        meta={list.length > 0 ? `${list.length} total` : undefined}
      />

      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <Panel className="h-fit overflow-hidden">
          {sessions.isLoading ? (
            <SkeletonRows rows={5} />
          ) : list.length === 0 ? (
            <EmptyState icon={<Terminal />} title="No sessions yet" hint="Run a task." />
          ) : (
            <ul>
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
                      tone={toneFor(session.status)}
                      pulse={session.status === "running"}
                    />
                    <span className="machine flex-1 truncate text-xs text-ink">
                      {session.id.slice(0, 8)}
                    </span>
                    <span className="text-xs text-ink-muted">{session.status}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="min-w-0">
          <PanelHeader className="border-b border-edge">
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
              {status ? (
                <StatusPill
                  tone={toneFor(status)}
                  dot={status === "running"}
                  pulse={status === "running"}
                >
                  {live.connected ? "live · " : ""}
                  {status}
                </StatusPill>
              ) : null}
            </div>
          </PanelHeader>

          <div className="p-4">
            {!selected ? (
              <EmptyState title="Select a session" hint="Its tool calls stream in here." />
            ) : entries.length === 0 ? (
              <EmptyState title="No tool calls logged yet" />
            ) : (
              <Well className="max-h-[60vh] overflow-auto p-0">
                <ol className="machine divide-y divide-edge text-xs">
                  {entries.map((entry, index) => (
                    <li
                      key={`${entry.eventId ?? index}`}
                      className="flex gap-2.5 px-3.5 py-1.5 leading-relaxed"
                    >
                      <span className="shrink-0 text-ink-faint">{entry.at.slice(11, 19)}</span>
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

interface LiveFrame {
  status: SessionDto["status"];
  entries: ToolCallLogEntry[];
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
function useLiveSession(
  sessionId: string | null,
  status: SessionDto["status"] | undefined,
): { status: SessionDto["status"] | null; entries: ToolCallLogEntry[] | null; connected: boolean } {
  const [frame, setFrame] = useState<LiveFrame | null>(null);
  const [connected, setConnected] = useState(false);
  const shouldStream = status === "running" || status === "waiting-inbox";

  useEffect(() => {
    setFrame(null);
    setConnected(false);
    if (!sessionId || !shouldStream) {
      return;
    }

    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(`${BASE}/sessions/${sessionId}/live`, {
          headers: {
            authorization: `Bearer ${getToken() ?? ""}`,
            accept: "text/event-stream",
          },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          return;
        }
        setConnected(true);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });

          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const payload = buffer
              .slice(0, boundary)
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("");
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");

            if (payload) {
              try {
                setFrame(JSON.parse(payload) as LiveFrame);
              } catch {
                // A malformed frame is not worth tearing the stream down for;
                // the next one carries the full state anyway.
              }
            }
          }
        }
      } catch {
        // Aborted or the stream broke — the poll below keeps the view current.
      } finally {
        setConnected(false);
      }
    })();

    return () => controller.abort();
  }, [sessionId, shouldStream]);

  return { status: frame?.status ?? null, entries: frame?.entries ?? null, connected };
}
