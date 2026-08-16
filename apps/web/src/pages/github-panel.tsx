import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, GitFork, Link2, Unlink } from "lucide-react";
import { api, ApiError } from "../api";
import { Button } from "../components/ui/button";
import { useConfirm } from "../components/ui/confirm";
import { InlineError } from "../components/ui/feedback";
import { IconTile, toneFor } from "../components/ui/icon-tile";
import { Meta, MetaRow } from "../components/ui/meta";
import { Panel, PanelHeader, PanelTitle, Well } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";

/**
 * Connecting GitHub instead of pasting a token.
 *
 * A personal access token is long-lived and carries the union of every scope
 * its owner ticked; a GitHub App installation mints a token that expires in an
 * hour and reaches only the repositories the operator picked on github.com.
 * For a system that hands credentials to a model, that difference is the whole
 * argument, so this panel sits above the token-based form rather than beside
 * it.
 *
 * When no App is configured the panel says what to set rather than hiding —
 * "connect" that silently does nothing is worse than an instruction.
 */
export function GithubPanel({ projectId }: { projectId: string }): React.JSX.Element {
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const status = useQuery({
    queryKey: ["github-status", projectId],
    queryFn: () => api.githubStatus(projectId),
  });

  const connect = useMutation({
    mutationFn: () => api.githubInstallUrl(projectId),
    onSuccess: (result) => {
      // A full navigation, not a popup: GitHub refuses to render its install
      // screen in a frame, and the flow ends by redirecting back here.
      window.location.href = result.url;
    },
  });

  const disconnect = useMutation({
    mutationFn: (id: string) => api.disconnectGithub(projectId, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["github-status", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["repos", projectId] });
    },
  });

  const installations = status.data?.installations ?? [];
  const configured = status.data?.configured ?? false;

  return (
    <Panel>
      <PanelHeader className="border-b border-edge">
        <PanelTitle accent="violet">GitHub</PanelTitle>
        {configured ? (
          installations.length > 0 ? (
            <StatusPill tone="live" dot>
              connected
            </StatusPill>
          ) : (
            <Button variant="outline" onClick={() => connect.mutate()} disabled={connect.isPending}>
              <Link2 />
              {connect.isPending ? "Opening GitHub…" : "Connect GitHub"}
            </Button>
          )
        ) : (
          <StatusPill>not configured</StatusPill>
        )}
      </PanelHeader>

      <div className="space-y-3 p-4">
        {/* A failed status read used to fall through to `configured: false`,
            which told the operator to go and create a GitHub App they may
            already have. */}
        {status.isError ? (
          <InlineError>Unable to load the GitHub connection status.</InlineError>
        ) : !configured ? (
          <>
            <p className="text-[13px] leading-relaxed text-ink-muted">
              Connect a GitHub App to grant repository-specific access with short-lived tokens.
            </p>
            <Well className="space-y-1.5">
              <p className="text-xs leading-relaxed text-ink-muted">
                No GitHub App is configured. Create one at{" "}
                <span className="machine text-ink">github.com/settings/apps/new</span> with{" "}
                <span className="machine text-ink">Contents: read &amp; write</span> and{" "}
                <span className="machine text-ink">Metadata: read</span>, set its callback to{" "}
                <span className="machine text-ink">&lt;PUBLIC_URL&gt;/github/setup</span>, then put
                these in <span className="machine text-ink">.env</span>:
              </p>
              <p className="machine text-xs leading-relaxed text-ink">
                GITHUB_APP_ID · GITHUB_APP_SLUG · GITHUB_APP_PRIVATE_KEY
              </p>
              <p className="text-xs leading-relaxed text-ink-faint">
                Configure the private key as a Secret Manager reference, not as a stored PEM value.
              </p>
            </Well>
          </>
        ) : installations.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-ink-muted">
            Connect GitHub and select the repositories AgentOS may access.
          </p>
        ) : (
          <>
            <ul className="space-y-2">
              {installations.map((installation) => (
                <li
                  key={installation.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-edge px-3 py-2 transition-colors hover:border-edge-strong"
                >
                  {/* Identity opens the row, then the two facts that decide
                      whether this installation can reach what a repo needs.
                      The separator used to be a hand-typed middle dot. */}
                  <span className="flex min-w-0 items-center gap-2.5">
                    <IconTile tone={toneFor(installation.id)} size="sm">
                      <GitFork />
                    </IconTile>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-ink">
                        {installation.accountLogin || "an account"}
                      </span>
                      <MetaRow>
                        <Meta>
                          {installation.repositorySelection === "all"
                            ? "every repository"
                            : "selected repositories"}
                        </Meta>
                        {installation.accountType ? (
                          <Meta icon={<Building2 />}>{installation.accountType}</Meta>
                        ) : null}
                      </MetaRow>
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      confirm({
                        kind: "warn",
                        title: `Disconnect ${installation.accountLogin || "this account"}?`,
                        body: (
                          <>
                            Repositories using this installation will lose authentication until a
                            replacement credential is assigned. GitHub data will not be deleted.
                          </>
                        ),
                        confirmLabel: "Disconnect",
                        onConfirm: () => disconnect.mutate(installation.id),
                      })
                    }
                  >
                    <Unlink />
                    Disconnect
                  </Button>
                </li>
              ))}
            </ul>
            <Button variant="ghost" size="sm" onClick={() => connect.mutate()}>
              <Link2 />
              Connect another account
            </Button>
          </>
        )}

        {connect.isError ? (
          <InlineError>
            {connect.error instanceof ApiError
              ? connect.error.message
              : "Unable to start GitHub authorization."}
          </InlineError>
        ) : null}

        {/* Disconnecting failed in silence: the dialog closed, the row stayed,
            and nothing said why. */}
        {disconnect.isError ? (
          <InlineError>
            {disconnect.error instanceof ApiError
              ? disconnect.error.message
              : "Unable to disconnect the GitHub installation."}
          </InlineError>
        ) : null}
      </div>
    </Panel>
  );
}
