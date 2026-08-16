
export const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const TOKEN_KEY = "agentos.operatorToken";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token.trim());
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Carries the HTTP status so the UI can tell "your token is wrong" apart from
 * "the control plane is down" apart from "there is genuinely nothing here".
 * Rendering all three as an empty page is how an operator ends up debugging a
 * seed script when the real problem is a stale token.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ApiError";
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch (cause) {
    // fetch only rejects when the request never reached a server.
    throw new ApiError(0, `cannot reach the control plane at ${BASE}`, { cause });
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new ApiError(response.status, `${response.status} ${response.statusText} — ${detail}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/** Matches apps/api/src/activity/activity.service.ts — not published from @agentos/shared. */
export interface ActivityEntryDto {
  id: string;
  kind: "task-activity" | "session" | "inbox" | "goal";
  at: string;
  title: string;
  detail: string;
  taskId: string | null;
  sessionId: string | null;
  goalId: string | null;
}
