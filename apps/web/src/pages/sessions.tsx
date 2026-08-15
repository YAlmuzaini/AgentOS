import type { SessionDto, ToolCallLogEntry } from "@agentos/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, BASE, getToken } from "../api";

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

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <section>
        <h1 className="mb-3 text-lg font-semibold">Sessions</h1>
        <ul className="space-y-1">
          {(sessions.data ?? []).map((session) => (
            <li key={session.id}>
              <button
                className={`w-full rounded-sm border border-edge px-2 py-1.5 text-left text-sm ${
                  selected === session.id ? "bg-edge" : "bg-surface-raised"
                }`}
                onClick={() => setSelected(session.id)}
              >
                <span className="machine text-xs">{session.id.slice(0, 8)}</span>
                <span className="ml-2 text-ink-muted">{session.status}</span>
              </button>
            </li>
          ))}
        </ul>
        {sessions.data?.length === 0 ? (
          <p className="text-sm text-ink-muted">No sessions yet. Run a task.</p>
        ) : null}
      </section>

      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
          Tool calls {status ? `· ${status}` : ""}
          {live.connected ? <span className="ml-2 text-xs text-live">live</span> : null}
        </h2>
        {detail.data?.traceUrl ? (
          <a
            className="mb-3 inline-block text-xs text-link underline"
            href={detail.data.traceUrl}
            target="_blank"
            rel="noreferrer"
          >
            open runtime trace
          </a>
        ) : null}
        <ol className="space-y-1 font-mono text-xs">
          {entries.map((entry, index) => (
            <li key={`${entry.eventId ?? index}`} className="rounded-sm bg-surface-sunken px-2 py-1">
              <span className="text-ink-faint">{entry.at.slice(11, 19)}</span>{" "}
              <span className="text-ink">{entry.name ?? entry.type}</span>{" "}
              <span className="text-ink-muted">{entry.summary}</span>
            </li>
          ))}
        </ol>
        {selected && entries.length === 0 ? (
          <p className="text-sm text-ink-muted">No tool calls logged yet.</p>
        ) : null}
        {!selected ? (
          <p className="text-sm text-ink-muted">Select a session to view its tool calls.</p>
        ) : null}
        {detail.data?.error ? (
          <p className="mt-3 rounded-sm border border-danger/40 bg-surface-raised p-2 text-xs text-danger">
            {detail.data.error}
          </p>
        ) : null}
      </section>
    </div>
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
