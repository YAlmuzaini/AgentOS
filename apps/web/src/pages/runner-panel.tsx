import { RUNNER_CAPABILITIES, type DefaultRunner, type RunnerStatusDto } from "@agentos/shared";
import { InlineError } from "../components/ui/feedback";
import { StatusPill } from "../components/ui/pill";
import { Panel, PanelHeader, PanelTitle, Well } from "../components/ui/panel";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { Button } from "../components/ui/button";

/**
 * The money switch.
 *
 * `cloud` bills the Anthropic API per token; `local` runs Claude Code on a
 * machine the operator owns, against a subscription, at a flat rate. That
 * difference is the whole reason the local backend exists, so this panel is
 * blunt about which one is about to spend.
 *
 * It also refuses to imply more than it can deliver. `local` now means
 * local-only: an unreachable worker fails the session rather than quietly
 * billing the API, because an operator who switched precisely to stop paying
 * per token would otherwise find out on their invoice. That makes worker
 * availability an operational fact rather than a footnote, so it is shown
 * next to the choice — and when `local` is selected and the worker is down,
 * the warning says runs will *fail*, not that they will move.
 */
export function RunnerPanel({
  value,
  onChange,
  status,
}: {
  value: DefaultRunner;
  onChange: (next: DefaultRunner) => void;
  status: RunnerStatusDto | undefined;
}): React.JSX.Element {
  const localReachable = Boolean(status?.local.healthy);
  const localConfigured = Boolean(status?.local.configured);
  const client = useQueryClient();
  const drain = useMutation({
    mutationFn: (draining: boolean) => api.setLocalRunnerDrain(draining),
    onSuccess: () => client.invalidateQueries({ queryKey: ["runner-status"] }),
  });

  return (
    <Panel>
      <PanelHeader className="border-b border-edge">
        <PanelTitle accent="violet">Where sessions run</PanelTitle>
        {status ? (
          <StatusPill tone={localReachable ? "live" : "neutral"}>
            {localReachable ? "local worker up" : "local worker unavailable"}
          </StatusPill>
        ) : null}
      </PanelHeader>

      <div className="space-y-4 p-4">
        <p className="text-[13px] leading-relaxed text-ink-muted">
          This setting applies to agents without an explicit runner preference. Cloud sessions use
          Anthropic's managed sandbox and consume API credits. Local sessions run on your configured
          worker and are not sandboxed.
        </p>
        <p className="text-xs leading-relaxed text-ink-faint">
          Cloud: {RUNNER_CAPABILITIES.cloud.enforceableEgress ? "enforced egress" : "unenforced egress"}, {RUNNER_CAPABILITIES.cloud.mcpPerToolFiltering ? "per-tool MCP grants" : "whole-server MCP grants"}. Local/VPS: {RUNNER_CAPABILITIES.local.enforceableEgress ? "enforced egress" : "network policy must be enforced outside AgentOS"}, {RUNNER_CAPABILITIES.local.mcpPerToolFiltering ? "per-tool MCP grants" : "whole-server MCP attachment only"}.
        </p>

        <div className="space-y-2">
          {OPTIONS.map((option) => {
            const chosen = value === option.value;
            return (
              <label
                key={option.value}
                // Selection reads as the row the operator is standing on — the
                // fill and the darker hairline, never a colour. Choosing where
                // sessions run is not a status.
                className={`flex cursor-pointer items-start gap-3 rounded-control border p-3 transition-colors ${
                  chosen ? "border-edge-strong bg-sunken" : "border-edge hover:bg-sunken/70"
                }`}
              >
                <input
                  type="radio"
                  name="defaultRunner"
                  className="mt-0.5"
                  checked={chosen}
                  onChange={() => onChange(option.value)}
                />
                <span className="min-w-0 space-y-1">
                  <span className="block text-[13px] font-medium text-ink">{option.label}</span>
                  <span className="block text-xs leading-relaxed text-ink-faint">{option.hint}</span>
                </span>
              </label>
            );
          })}
        </div>

        {/* The two ways this choice silently does nothing. Both are worth more
            than a passing mention: the operator's next bill is the alternative
            way of finding out. Both wear the danger surface the rest of the app
            uses for a real fault, rather than a hand-rolled red box that read as
            muted prose inside a red border. */}
        {value !== "cloud" && !localConfigured ? (
          <InlineError className="leading-relaxed">
            No local worker is configured.{" "}
            {value === "local"
              ? "Sessions set to run locally will fail rather than move to the cloud."
              : "Sessions will use the cloud runner and consume API credits."}{" "}
            Set <span className="machine">LOCAL_RUNNER_URL</span> in{" "}
            <span className="machine">.env</span> and start{" "}
            <span className="machine">apps/local-runner</span>, then restart the API.
          </InlineError>
        ) : null}

        {value !== "cloud" && localConfigured && !localReachable ? (
          <InlineError className="leading-relaxed">
            A local worker is configured at{" "}
            {/* A URL is copyable, and this is the one an operator is about to go
                and check, so it never wraps mid-host. */}
            <span className="machine break-all">{status?.local.url}</span> but is unavailable.{" "}
            {value === "local"
              ? "Sessions will fail with an explanation rather than move to the cloud — local means local. Switch to Automatic to allow a paid fallback."
              : "Sessions will use the cloud runner and consume API credits."}
          </InlineError>
        ) : null}

        {value !== "cloud" && localReachable ? (
          <Well className="space-y-3 text-xs leading-relaxed text-ink-muted">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-ink">{status?.local.location === "personal-vps" ? "Personal VPS" : "Local computer"}{status?.local.workerId ? ` · ${status.local.workerId}` : ""}</p>
                <p className="tabular-nums">{status?.local.activeSessions ?? 0} active of {status?.local.capacity ?? "unknown"} capacity · {status?.local.draining ? "draining" : status?.local.ready ? "ready" : "at capacity"}{status?.local.version ? ` · ${status.local.version}` : ""}</p>
              </div>
              {status?.local.capabilities.includes("drain") ? <Button size="sm" variant="outline" disabled={drain.isPending} onClick={() => drain.mutate(!status.local.draining)}>{status.local.draining ? "Resume intake" : "Drain worker"}</Button> : null}
            </div>
            The local worker cannot enforce restricted network policies. Under{" "}
            <span className="machine text-ink">auto</span>, agents with restricted egress use the
            cloud runner; under <span className="machine text-ink">local</span> the worker refuses
            them and the session fails. Assign an{" "}
            <span className="machine text-ink">open</span> environment to run them locally.
          </Well>
        ) : null}
      </div>
    </Panel>
  );
}

const OPTIONS: Array<{ value: DefaultRunner; label: string; hint: string }> = [
  {
    value: "auto",
    label: "Automatic",
    hint:
      "Use the local worker when available; otherwise fall back to the cloud runner and " +
      "consume API credits.",
  },
  {
    value: "local",
    label: "Local worker only",
    hint:
      "Use the local worker, or fail. Sessions are never sent to the cloud, so an unavailable " +
      "worker stops runs instead of billing API credits.",
  },
  {
    value: "cloud",
    label: "Anthropic managed",
    hint: "Use Anthropic's managed sandbox with network controls and usage-based API billing.",
  },
];
