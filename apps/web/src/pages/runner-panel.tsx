import type { DefaultRunner, RunnerStatusDto } from "@agentos/shared";
import { StatusPill } from "../components/ui/pill";
import { Panel, PanelHeader, PanelTitle } from "../components/ui/panel";

/**
 * The money switch.
 *
 * `cloud` bills the Anthropic API per token; `local` runs Claude Code on a
 * machine the operator owns, against a subscription, at a flat rate. That
 * difference is the whole reason the local backend exists, so this panel is
 * blunt about which one is about to spend.
 *
 * It also refuses to imply more than it can deliver. Choosing `local` while no
 * worker is reachable routes every run to the cloud and bills for it — an
 * operator who switched precisely to stop paying per token would find out on
 * their invoice. So availability is shown next to the choice, not hidden.
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

        <div className="space-y-2">
          {OPTIONS.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-edge p-3 hover:bg-sunken"
            >
              <input
                type="radio"
                name="defaultRunner"
                className="mt-0.5"
                checked={value === option.value}
                onChange={() => onChange(option.value)}
              />
              <span className="space-y-1">
                <span className="block text-[13px] font-medium text-ink">{option.label}</span>
                <span className="block text-xs leading-relaxed text-ink-faint">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>

        {/* The two ways this choice silently does nothing. Both are worth more
            than a passing mention: the operator's next bill is the alternative
            way of finding out. */}
        {value !== "cloud" && !localConfigured ? (
          <p className="rounded-md border border-danger-line bg-danger-soft p-3 text-xs leading-relaxed text-ink-muted">
            No local worker is configured. Sessions will use the cloud runner. Set{" "}
            <span className="machine text-ink-muted">LOCAL_RUNNER_URL</span> in{" "}
            <span className="machine text-ink-muted">.env</span> and start{" "}
            <span className="machine text-ink-muted">apps/local-runner</span>, then restart the API.
          </p>
        ) : null}

        {value !== "cloud" && localConfigured && !localReachable ? (
          <p className="rounded-md border border-danger-line bg-danger-soft p-3 text-xs leading-relaxed text-ink-muted">
            A local worker is configured at{" "}
            <span className="machine text-ink-muted">{status?.local.url}</span> but is unavailable.
            Sessions will use the cloud runner and consume API credits.
          </p>
        ) : null}

        {value !== "cloud" && localReachable ? (
          <p className="rounded-md border border-edge bg-sunken p-3 text-xs leading-relaxed text-ink-muted">
            The local worker cannot enforce restricted network policies. Agents with restricted
            egress will use the cloud runner. Assign an <span className="machine text-ink-muted">open</span>{" "}
            environment to run them locally.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

const OPTIONS: Array<{ value: DefaultRunner; label: string; hint: string }> = [
  {
    value: "auto",
    label: "Automatic",
    hint: "Use the local worker when available; otherwise use the cloud runner.",
  },
  {
    value: "local",
    label: "Local worker only",
    hint: "Prefer the local worker. The cloud runner is used when the worker is unavailable.",
  },
  {
    value: "cloud",
    label: "Anthropic managed",
    hint: "Use Anthropic's managed sandbox with network controls and usage-based API billing.",
  },
];
