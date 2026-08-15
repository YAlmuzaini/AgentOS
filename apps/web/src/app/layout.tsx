import { useQueryClient } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { ApiError, clearToken, getToken, setToken } from "../api";
import { useActiveProject } from "../hooks/use-project";

/** SPEC §18 sidebar. Sections without a Phase-1 screen render a placeholder. */
const SECTIONS = [
  { to: "/tasks", label: "Tasks" },
  { to: "/goals", label: "Goals" },
  { to: "/inbox", label: "Inbox" },
  { to: "/sessions", label: "Sessions" },
  { to: "/activity", label: "Activity" },
  { to: "/agents", label: "Agents" },
  { to: "/skills", label: "Skills" },
  { to: "/files", label: "Files" },
  { to: "/mcps", label: "MCPs" },
  { to: "/repos", label: "Repos" },
  { to: "/environment", label: "Environment" },
  { to: "/secrets", label: "Secrets" },
  { to: "/triggers", label: "Triggers" },
  { to: "/automations", label: "Automations" },
  { to: "/settings", label: "Settings" },
] as const;

export function Layout(): React.JSX.Element {
  const [token, setLocalToken] = useState(getToken() ?? "");
  const [saved, setSaved] = useState(Boolean(getToken()));
  const queryClient = useQueryClient();
  // Every screen hangs off the project list, so this one query is also the
  // app's connection check. It is the same cache entry the pages read.
  const { error } = useActiveProject();

  function forgetToken(): void {
    clearToken();
    setLocalToken("");
    setSaved(false);
    queryClient.clear();
  }

  if (!saved) {
    return <TokenGate token={token} onChange={setLocalToken} onSave={() => {
      setToken(token);
      setSaved(true);
      queryClient.clear();
    }} />;
  }

  if (error) {
    return <Unreachable error={error} onRetry={() => queryClient.invalidateQueries()} onForget={forgetToken} />;
  }

  return (
    <div className="flex h-full flex-col sm:flex-row">
      {/* Below sm the sidebar would squeeze content into a sliver — the PWA's
          mobile surface is /inbox alone, so the nav simply steps aside. */}
      <nav className="hidden w-52 shrink-0 border-r border-edge bg-surface-raised p-4 sm:block">
        <div className="mb-6 text-sm font-semibold tracking-wide text-ink-muted">AgentOS</div>
        <ul className="space-y-1">
          {SECTIONS.map((section) => (
            <li key={section.to}>
              <Link
                to={section.to}
                className="block rounded-sm px-2 py-1.5 text-sm text-ink hover:bg-edge"
                activeProps={{ className: "block rounded-sm px-2 py-1.5 text-sm bg-edge text-ink" }}
              >
                {section.label}
              </Link>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={forgetToken}
          className="mt-6 rounded-sm px-2 py-1.5 text-sm text-ink-faint hover:text-ink"
        >
          Change token
        </button>
      </nav>
      <main className="flex-1 overflow-x-hidden overflow-y-auto p-3 sm:p-6">
        <Outlet />
      </main>
    </div>
  );
}

/**
 * The screen an operator sees when the control plane says no. Previously every
 * page rendered its own empty state here, so a rejected token read as "no data
 * yet" — the operator debugs the seed instead of the credential.
 */
function Unreachable(props: {
  error: Error;
  onRetry: () => void;
  onForget: () => void;
}): React.JSX.Element {
  const status = props.error instanceof ApiError ? props.error.status : null;
  const rejected = status === 401 || status === 403;
  const offline = status === 0;

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md space-y-3 rounded-md border border-edge bg-surface-raised p-5">
        <h1 className="text-lg font-semibold text-danger">
          {rejected
            ? "That token was rejected"
            : offline
              ? "The control plane is not answering"
              : "The control plane returned an error"}
        </h1>
        <p className="text-sm text-ink-muted">
          {rejected
            ? "It does not match AGENTOS_OPERATOR_TOKEN on the server. Nothing is wrong with your data."
            : offline
              ? "Start it with `pnpm --filter @agentos/api dev`, then retry."
              : "The request reached the server and it failed."}
        </p>
        <p className="machine text-xs text-ink-faint break-words">{props.error.message}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={props.onRetry}
            className="rounded-sm bg-edge px-3 py-1.5 text-sm hover:bg-edge-strong"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={props.onForget}
            className="rounded-sm bg-surface-raised px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
          >
            Enter a different token
          </button>
        </div>
      </div>
    </div>
  );
}

function TokenGate(props: {
  token: string;
  onChange: (value: string) => void;
  onSave: () => void;
}): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <form
        className="w-full max-w-sm space-y-3 rounded-md border border-edge bg-surface-raised p-5"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSave();
        }}
      >
        <h1 className="text-lg font-semibold">Operator token</h1>
        <p className="text-sm text-ink-muted">
          Paste the value of <code>AGENTOS_OPERATOR_TOKEN</code>. It is kept in this browser only.
        </p>
        <input
          type="password"
          value={props.token}
          onChange={(event) => props.onChange(event.target.value)}
          className="w-full rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm machine"
          autoComplete="off"
        />
        <button
          type="submit"
          className="w-full rounded-sm bg-edge px-3 py-1.5 text-sm hover:bg-edge-strong"
        >
          Continue
        </button>
      </form>
    </div>
  );
}
