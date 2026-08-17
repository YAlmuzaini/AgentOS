import type { BriefingItem, ExecutiveBriefingDto } from "@agentos/shared";
import { ArrowUpRight, CheckCircle2, CircleAlert, Clock3 } from "lucide-react";
import { Panel, PanelHeader, PanelTitle } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";

export function ExecutiveBriefing({ briefing }: { briefing: ExecutiveBriefingDto }): React.JSX.Element {
  const attention = briefing.decisions.length + briefing.blocked.length + briefing.failures.length + briefing.unusuallyLong.length;
  return (
    <Panel className="space-y-4 p-5">
      <PanelHeader>
        <div>
          <PanelTitle accent="amber">Executive briefing</PanelTitle>
          <p className="mt-1 text-xs text-ink-muted">Deterministic status since {new Date(briefing.since).toLocaleString()}.</p>
        </div>
        <StatusPill tone={attention > 0 ? "gate" : "live"}>{attention > 0 ? `${attention} need attention` : "nothing blocking"}</StatusPill>
      </PanelHeader>
      <div className="grid gap-x-6 gap-y-4 lg:grid-cols-3">
        <BriefingLane title="Needs you" icon={<CircleAlert />} items={[...briefing.decisions, ...briefing.blocked, ...briefing.failures, ...briefing.unusuallyLong]} empty="No decisions, blockers, failures, or unusually long runs." />
        <BriefingLane title="Completed" icon={<CheckCircle2 />} items={[...briefing.readyForReview, ...briefing.completed]} empty="Nothing new is ready for review or completed." />
        <BriefingLane title="Can continue" icon={<Clock3 />} items={briefing.continueWithoutMe} empty="No unattended goal is currently progressing." />
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-edge pt-3 text-xs text-ink-muted tabular-nums">
        <span>{briefing.execution.localSubscriptionSessions} local/VPS subscription session{briefing.execution.localSubscriptionSessions === 1 ? "" : "s"}</span>
        {briefing.execution.localMeteredSessions > 0 ? <span>{briefing.execution.localMeteredSessions} local-worker session{briefing.execution.localMeteredSessions === 1 ? "" : "s"} used a metered API credential</span> : null}
        {briefing.execution.localUnknownSessions > 0 ? <span>{briefing.execution.localUnknownSessions} local-worker session{briefing.execution.localUnknownSessions === 1 ? "" : "s"} with unknown billing</span> : null}
        <span>{briefing.execution.cloudSessions} cloud session{briefing.execution.cloudSessions === 1 ? "" : "s"} · ${briefing.execution.cloudCostUsd.toFixed(2)} recorded</span>
      </div>
    </Panel>
  );
}

function BriefingLane({ title, icon, items, empty }: { title: string; icon: React.ReactNode; items: BriefingItem[]; empty: string }): React.JSX.Element {
  return <section className="min-w-0"><h3 className="mb-2 flex items-center gap-2 text-xs font-medium text-ink">{<span className="text-ink-faint [&>svg]:size-3.5">{icon}</span>}{title}</h3>{items.length === 0 ? <p className="text-xs leading-relaxed text-ink-faint">{empty}</p> : <ul className="divide-y divide-edge">{items.slice(0, 5).map((item) => <li key={item.id} className="py-2 first:pt-0"><a href={item.href} className="group block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-focus"><span className="flex items-start justify-between gap-2 text-xs font-medium text-ink group-hover:text-accent">{item.title}<ArrowUpRight className="mt-0.5 size-3 shrink-0" /></span><span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-ink-faint">{item.detail}</span></a></li>)}</ul>}</section>;
}
