import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { api, BASE } from "../api";
import { StatusPill } from "../components/ui/pill";
import { Page, PageHeader } from "../components/ui/page";
import { Panel, PanelHeader, PanelTitle, Well } from "../components/ui/panel";
import { useProjects } from "../hooks/use-project";
import { EnableNotifications } from "./enable-notifications";

/**
 * The installation, not a project.
 *
 * This page and `/project` were one page called "Settings", and that was the
 * single biggest source of "wait — does this apply to everything?". Nothing
 * here changes when the operator switches project: the worker lives at one
 * address, this browser holds one token, and a push subscription is a property
 * of the device rather than of any workspace.
 *
 * Two columns for the same reason `/project` has them — a single `max-w-2xl`
 * column on a desk monitor is a narrow strip of panels against an empty half
 * screen, and this app is read at a desk.
 */
export function SettingsPage(): React.JSX.Element {
  const runners = useQuery({
    queryKey: ["runner-status"],
    queryFn: () => api.runnerStatus(),
    refetchInterval: 15_000,
  });
  const { projects, active } = useProjects();

  const local = runners.data?.local;

  return (
    <Page>
      <PageHeader icon={<Settings />} title="AgentOS settings" meta="Shared by every project" />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <Panel>
            <PanelHeader className="border-b border-edge">
              <PanelTitle accent="violet">Runners</PanelTitle>
              {local ? (
                <StatusPill tone={local.healthy ? "live" : "neutral"} dot={local.healthy}>
                  {local.healthy
                    ? "worker up"
                    : local.configured
                      ? "not answering"
                      : "not configured"}
                </StatusPill>
              ) : null}
            </PanelHeader>
            <div className="space-y-4 p-4">
              <p className="text-[13px] leading-relaxed text-ink-muted">
                Runner availability applies to this installation. Select a default runner separately
                in each project's settings.
              </p>

              <dl className="grid gap-px overflow-hidden rounded-control border border-edge bg-edge">
                <div className="flex items-baseline justify-between gap-3 bg-panel px-3 py-2.5">
                  <dt className="text-[13px] text-ink">Anthropic managed</dt>
                  <dd className="text-[13px] text-ink-faint">
                    {runners.data?.cloud.configured ? "configured" : "no API key"}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 bg-panel px-3 py-2.5">
                  <dt className="shrink-0 text-[13px] text-ink">Local worker</dt>
                  <dd className="machine truncate text-xs text-ink-faint">
                    {local?.url || "LOCAL_RUNNER_URL unset"}
                  </dd>
                </div>
              </dl>

              <p className="text-[13px] leading-relaxed text-ink-muted">
                Each session receives an isolated temporary directory and only the resources granted
                by its project.
              </p>
            </div>
          </Panel>

          <Panel>
            <PanelHeader className="border-b border-edge">
              <PanelTitle accent="amber">Notifications</PanelTitle>
              <EnableNotifications />
            </PanelHeader>
            <div className="p-4">
              <p className="text-[13px] leading-relaxed text-ink-muted">
                Notifications are enabled for this browser across all projects.
              </p>
            </div>
          </Panel>
        </div>

        <div className="min-w-0 space-y-5 xl:sticky xl:top-0">
          <Panel>
            <PanelHeader className="border-b border-edge">
              <PanelTitle accent="sky">This browser</PanelTitle>
            </PanelHeader>
            <div className="space-y-3 p-4">
              <p className="text-[13px] leading-relaxed text-ink-muted">
                The operator token authorizes access to every project on this control plane.
              </p>
              <Well className="space-y-1">
                <p className="machine text-xs break-all text-ink">{BASE}</p>
                <p className="text-xs text-ink-faint">
                  {projects.length} project{projects.length === 1 ? "" : "s"}
                  {active ? ` · viewing ${active.name}` : ""}
                </p>
              </Well>
            </div>
          </Panel>

          <p className="px-1 text-xs leading-relaxed text-ink-faint">
            Default runner and session maintenance settings are configured per project.{" "}
            <Link to="/project" className="text-link hover:underline">
              Open project settings
            </Link>
            .
          </p>
        </div>
      </div>
    </Page>
  );
}
