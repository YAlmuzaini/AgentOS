import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { KeyRound, PlugZap, ShieldAlert, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { ApiError, clearToken, getToken, setToken } from "../api";
import { Button } from "../components/ui/button";
import { CommandPalette, useCommandPalette } from "../components/ui/command-palette";
import { InlineError } from "../components/ui/feedback";
import { Input } from "../components/ui/form";
import { Panel } from "../components/ui/panel";
import { useActiveProject } from "../hooks/use-project";
import { Sidebar } from "./shell/sidebar";
import { Topbar } from "./shell/topbar";

export function Layout(): React.JSX.Element {
  const [token, setLocalToken] = useState(getToken() ?? "");
  const [saved, setSaved] = useState(Boolean(getToken()));
  const [navOpen, setNavOpen] = useState(false);
  const palette = useCommandPalette();
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
    return (
      <TokenGate
        token={token}
        onChange={setLocalToken}
        onSave={() => {
          setToken(token);
          setSaved(true);
          queryClient.clear();
        }}
      />
    );
  }

  if (error) {
    return (
      <Unreachable
        error={error}
        onRetry={() => queryClient.invalidateQueries()}
        onForget={forgetToken}
      />
    );
  }

  return (
    <div className="flex h-full bg-chrome">
      {/* The permanent rail. Below lg it becomes the drawer below. */}
      <aside className="hidden w-60 shrink-0 lg:block">
        <Sidebar onForgetToken={forgetToken} onOpenSearch={() => palette.setOpen(true)} />
      </aside>

      <Dialog.Root open={navOpen} onOpenChange={setNavOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-overlay lg:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-64 shadow-pop outline-none lg:hidden">
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <Sidebar
              onNavigate={() => setNavOpen(false)}
              onCollapse={() => setNavOpen(false)}
              onForgetToken={forgetToken}
              onOpenSearch={() => {
                setNavOpen(false);
                palette.setOpen(true);
              }}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/*
        The working surface. It is a rounded white sheet inset from the chrome
        on desktop, which is what makes the rail read as a frame around it
        rather than as a column beside it.
      */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas lg:my-2 lg:mr-2 lg:rounded-panel lg:border lg:border-edge">
        <Topbar
          onOpenNav={() => setNavOpen(true)}
          onForgetToken={forgetToken}
          onOpenSearch={() => palette.setOpen(true)}
        />
        <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>

      <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
    </div>
  );
}

/**
 * The screen an operator sees when the control plane says no. Every page used
 * to render its own empty state here, so a rejected token read as "no data
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
    <Centred>
      <Panel className="rise w-full max-w-md p-6">
        <span className="mb-4 flex size-9 items-center justify-center rounded-control border border-danger-line bg-danger-soft text-danger">
          {rejected ? (
            <ShieldAlert className="size-4" />
          ) : offline ? (
            <PlugZap className="size-4" />
          ) : (
            <TriangleAlert className="size-4" />
          )}
        </span>
        <h1 className="text-[15px] font-semibold text-ink">
          {rejected
            ? "That token was rejected"
            : offline
              ? "The control plane is not answering"
              : "The control plane returned an error"}
        </h1>
        <p className="mt-1.5 text-[13px] text-ink-muted">
          {rejected
            ? "It does not match AGENTOS_OPERATOR_TOKEN on the server. Nothing is wrong with your data."
            : offline
              ? "Start it with `pnpm --filter @agentos/api dev`, then retry."
              : "The request reached the server and it failed."}
        </p>
        <InlineError className="machine mt-4 break-words">{props.error.message}</InlineError>
        <div className="mt-5 flex gap-2">
          <Button variant="solid" onClick={props.onRetry}>
            Retry
          </Button>
          <Button variant="ghost" onClick={props.onForget}>
            Enter a different token
          </Button>
        </div>
      </Panel>
    </Centred>
  );
}

function TokenGate(props: {
  token: string;
  onChange: (value: string) => void;
  onSave: () => void;
}): React.JSX.Element {
  return (
    <Centred>
      <Panel className="rise w-full max-w-sm p-6">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            props.onSave();
          }}
        >
          <span className="mb-4 flex size-9 items-center justify-center rounded-control border border-edge bg-sunken text-ink-muted">
            <KeyRound className="size-4" />
          </span>
          <h1 className="text-[15px] font-semibold text-ink">Operator token</h1>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            Paste the value of <code className="text-ink">AGENTOS_OPERATOR_TOKEN</code>. It is kept
            in this browser only.
          </p>
          <Input
            type="password"
            value={props.token}
            onChange={(event) => props.onChange(event.target.value)}
            className="machine mt-4"
            autoComplete="off"
            aria-label="Operator token"
          />
          <Button type="submit" variant="solid" size="lg" className="mt-3 w-full">
            Continue
          </Button>
        </form>
      </Panel>
    </Centred>
  );
}

function Centred(props: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center bg-chrome p-6">{props.children}</div>
  );
}
