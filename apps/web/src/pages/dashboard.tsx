import { TASK_STATUSES } from "@agentos/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Bot,
  History,
  Inbox,
  LayoutDashboard,
  Target,
  Terminal,
} from "lucide-react";
import { api, type ActivityEntryDto } from "../api";
import { Button } from "../components/ui/button";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Page, PageHeader } from "../components/ui/page";
import { Panel, PanelHeader, PanelTitle } from "../components/ui/panel";
import { Dot, StatusPill } from "../components/ui/pill";
import { StatCard, type MeterSegment } from "../components/ui/stat";
import { Table, TableCard, TD, TH, THead, TR } from "../components/ui/table";
import { useProjectGate } from "../hooks/use-project";
import { relativeTime } from "../lib/time";
import { NoProject, ProjectPending } from "./project-states";
import { BoardMeter, Figure, truncate } from "./dashboard-figures";
import { ActivityFeed } from "./activity-feed";

/**
 * The operator's opening screen.
 *
 * It answers the three questions PRODUCT.md says this product exists to
 * answer — what ran, what broke, and what is parked on me — and nothing else.
 *
 * Every number here is counted from the control plane. There is no trend line,
 * no percentage-change-versus-last-quarter and no efficiency score, because
 * AgentOS keeps no time series and inventing one would put a claim on screen
 * that the database cannot support. The reference's dashboard has those; this
 * one has the facts we actually hold.
 */
export function DashboardPage(): React.JSX.Element {
  const { project, pending, absent } = useProjectGate();
  const projectId = project?.id;

  const tasks = useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => api.tasks(projectId!),
    enabled: Boolean(projectId),
    refetchInterval: 5000,
  });
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: api.sessions,
    refetchInterval: 5000,
  });
  const inbox = useQuery({
    queryKey: ["inbox"],
    queryFn: () => api.inbox(),
    refetchInterval: 5000,
  });
  const goals = useQuery({
    queryKey: ["goals", projectId],
    queryFn: () => api.goals(projectId!),
    enabled: Boolean(projectId),
    refetchInterval: 10_000,
  });
  const agents = useQuery({
    queryKey: ["agents", projectId],
    queryFn: () => api.agents(projectId!),
    enabled: Boolean(projectId),
  });
  const activity = useQuery({
    queryKey: ["activity", projectId],
    queryFn: () => api.activity(projectId!, 12),
    enabled: Boolean(projectId),
    refetchInterval: 10_000,
  });

  if (absent) {
    return <NoProject />;
  }
  if (pending || !project) {
    return <ProjectPending />;
  }

  const taskList = tasks.data ?? [];
  const sessionList = sessions.data ?? [];
  const goalList = goals.data ?? [];

  const running = sessionList.filter((s) => s.status === "running").length;
  // "Idle" has to mean no container is being held, not merely none is in the
  // `running` state. `starting`, `committing` and `waiting-inbox` all hold one
  // — the last one deliberately and indefinitely — and calling that idle told
  // the operator nothing was costing them anything while something was.
  const holdingContainer = sessionList.filter((s) => HOLDS_CONTAINER.has(s.status)).length;
  // A clean finish is `destroyed` *and* no error. The control plane
  // deliberately leaves the status as `destroyed` while appending
  // "container was not destroyed: …" when teardown fails — which is precisely
  // the session still costing money. Counting it as finished put the one
  // number that should have raised the alarm in the reassuring column.
  const finished = sessionList.filter((s) => s.status === "destroyed" && !s.error).length;
  const failed = sessionList.filter((s) => s.status === "failed" || (s.status === "destroyed" && s.error)).length;
  const settled = finished + failed;

  const openQuestions = (inbox.data ?? []).filter((m) => m.status === "open").length;
  const gatedInReview = taskList.filter((t) => t.status === "review" && t.approvalGate).length;
  const unapprovedGoals = goalList.filter((g) => !g.dodApproved).length;
  const waiting = openQuestions + gatedInReview + unapprovedGoals;

  const spend = sessionList.reduce((sum, s) => sum + (Number(s.costUsd) || 0), 0);
  const activeGoals = goalList.filter((g) => g.status === "active");
  const goalSpend = goalList.reduce((sum, g) => sum + g.spendUsd, 0);
  // Only a goal that can still spend is worth warning about. Counting drafts,
  // paused, completed and stopped goals meant a finished one nagged forever.
  const uncapped = activeGoals.filter((g) => g.spendCapUsd === null).length;

  const boardMeter: MeterSegment[] = TASK_STATUSES.map((status) => ({
    label: STATUS_LABEL[status],
    value: taskList.filter((t) => t.status === status).length,
    accent: STATUS_ACCENT[status],
  }));

  return (
    <Page>
      <PageHeader
        icon={<LayoutDashboard />}
        title="Overview"
        meta={project.name}
        actions={
          holdingContainer > 0 ? (
            <StatusPill tone="live" dot pulse={running > 0}>
              {running > 0
                ? `${running} running`
                : `${holdingContainer} holding a container`}
            </StatusPill>
          ) : (
            <StatusPill tone="neutral">idle</StatusPill>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/*
          Settled sessions, not "success rate": a running session has not
          succeeded or failed yet, so counting it either way would be a lie.
        */}
        <StatCard
          label="Sessions settled"
          accent="emerald"
          value={settled === 0 ? "—" : `${Math.round((finished / settled) * 100)}%`}
          suffix={settled === 0 ? "no runs yet" : `${finished} of ${settled} finished cleanly`}
          meter={
            settled === 0
              ? undefined
              : [
                  { label: "Finished", value: finished, accent: "emerald" },
                  { label: "Failed", value: failed, accent: "amber" },
                ]
          }
          footer={running > 0 ? `${running} still running` : undefined}
        />

        <StatCard
          label="Waiting on you"
          accent="amber"
          value={waiting}
          suffix={waiting === 1 ? "item" : "items"}
          footer={
            waiting === 0 ? (
              "Nothing is parked on you."
            ) : (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {openQuestions > 0 ? <span>{openQuestions} inbox</span> : null}
                {gatedInReview > 0 ? <span>{gatedInReview} gated</span> : null}
                {unapprovedGoals > 0 ? <span>{unapprovedGoals} unapproved goal</span> : null}
              </span>
            )
          }
        />

        <StatCard
          label="Spend"
          accent="violet"
          value={`$${spend.toFixed(2)}`}
          suffix="across all sessions"
          footer={
            uncapped > 0 ? (
              <span className="text-gate">
                {uncapped} active goal{uncapped === 1 ? "" : "s"} with no spend cap
              </span>
            ) : (
              `$${goalSpend.toFixed(2)} of it against goals`
            )
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="p-4">
          <PanelTitle accent="sky">Board</PanelTitle>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="tnum text-[28px] leading-none font-semibold tracking-tight text-ink">
              {taskList.length}
            </span>
            <span className="text-[13px] text-ink-faint">tasks</span>
          </div>
          <div className="mt-3">
            <BoardMeter segments={boardMeter} />
          </div>
          <Button asChild variant="ghost" size="sm" className="mt-3 -ml-2">
            <Link to="/tasks">
              Open the board
              <ArrowRight />
            </Link>
          </Button>
        </Panel>

        <Panel className="p-4">
          <PanelTitle accent="violet">Fleet</PanelTitle>
          <dl className="mt-3 grid grid-cols-3 gap-3">
            <Figure
              icon={<Bot />}
              value={(agents.data ?? []).length}
              label="agents"
              to="/agents"
            />
            <Figure
              icon={<Target />}
              value={activeGoals.length}
              label={activeGoals.length === 1 ? "active goal" : "active goals"}
              to="/goals"
            />
            <Figure
              icon={<Terminal />}
              value={sessionList.length}
              label="sessions"
              to="/sessions"
            />
          </dl>
          {failed > 0 ? (
            <p className="mt-4 border-t border-edge pt-3 text-xs text-ink-muted">
              <span className="text-danger">{failed} failed</span> session
              {failed === 1 ? "" : "s"} in the log — worth reading before the next run.
            </p>
          ) : null}
        </Panel>
      </div>

      <ActivityFeed entries={activity.data ?? []} loading={activity.isLoading} />

    </Page>
  );
}

const STATUS_LABEL: Record<(typeof TASK_STATUSES)[number], string> = {
  todo: "To do",
  doing: "Doing",
  review: "Review",
  done: "Done",
};

const STATUS_ACCENT: Record<
  (typeof TASK_STATUSES)[number],
  "violet" | "sky" | "amber" | "emerald"
> = {
  todo: "violet",
  doing: "sky",
  review: "amber",
  done: "emerald",
};

/** The board meter labels every column, including the empty ones. */

/**
 * Session states that still hold a runtime container.
 *
 * `waiting-inbox` is the one worth naming: it holds its container on purpose,
 * for as long as the operator takes to answer, and that is exactly the case
 * where "idle" would be the most expensive word on the screen.
 */
const HOLDS_CONTAINER = new Set(["starting", "running", "committing", "waiting-inbox"]);
