import type { SessionDto, ToolCallLogEntry } from "@agentos/shared";
import { useEffect, useState } from "react";
import { BASE, getToken } from "../api";

/** The full state the server pushes on every frame. */
interface LiveFrame {
  status: SessionDto["status"];
  entries: ToolCallLogEntry[];
}

/** True while the session is still doing something worth watching. */
function isInFlight(status: SessionDto["status"] | undefined): boolean {
  return status === "starting" || status === "running" || status === "committing";
}

/** One session's live event stream, with reconnection. */
export function useLiveSession(
  sessionId: string | null,
  status: SessionDto["status"] | undefined,
): { status: SessionDto["status"] | null; entries: ToolCallLogEntry[] | null; connected: boolean } {
  const [frame, setFrame] = useState<LiveFrame | null>(null);
  const [connected, setConnected] = useState(false);
  const shouldStream = isInFlight(status) || status === "waiting-inbox";

  useEffect(() => {
    setFrame(null);
    setConnected(false);
    if (!sessionId || !shouldStream) {
      return;
    }

    const controller = new AbortController();
    // A generation token. Without it an old stream's `finally` could clear the
    // connected badge belonging to the stream that replaced it.
    let attempt = 0;
    let stopped = false;

    const connect = async (): Promise<void> => {
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
        attempt = 0;
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
        if (!stopped) {
          setConnected(false);
        }
      }

      // A proxy timeout or a blink of network closes the stream while the
      // session is still running. Reconnect with backoff rather than silently
      // dropping to two-second polling for the rest of the run.
      if (stopped || controller.signal.aborted) {
        return;
      }
      attempt += 1;
      const delay = Math.min(1000 * 2 ** (attempt - 1), 15_000);
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (!stopped && !controller.signal.aborted) {
        await connect();
      }
    };

    void connect();

    return () => {
      stopped = true;
      controller.abort();
    };
  }, [sessionId, shouldStream]);

  return { status: frame?.status ?? null, entries: frame?.entries ?? null, connected };
}
