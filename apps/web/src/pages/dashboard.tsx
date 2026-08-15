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
import { useActiveProject } from "../hooks/use-project";
import { relativeTime } from "../lib/time";
import { NoProject } from "./tasks";

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
  const { project } = useActiveProject();
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

  if (!project) {
    return <NoProject />;
  }

  const taskList = tasks.data ?? [];
  const sessionList = sessions.data ?? [];
  const goalList = goals.data ?? [];

  const running = sessionList.filter((s) => s.status === "running").length;
  const failed = sessionList.filter((s) => s.status === "failed").length;
  const finished = sessionList.filter((s) => s.status === "destroyed").length;
  const settled = finished + failed;

  const openQuestions = (inbox.data ?? []).filter((m) => m.status === "open").length;
  const gatedInReview = taskList.filter((t) => t.status === "review" && t.approvalGate).length;
  const unapprovedGoals = goalList.filter((g) => !g.dodApproved).length;
  const waiting = openQuestions + gatedInReview + unapprovedGoals;

  const spend = sessionList.reduce((sum, s) => sum + (Number(s.costUsd) || 0), 0);
  const activeGoals = goalList.filter((g) => g.status === "active");
  const goalSpend = goalList.reduce((sum, g) => sum + g.spendUsd, 0);
  const cappedGoals = goalList.filter((g) => g.spendCapUsd !== null);
  const uncapped = goalList.length - cappedGoals.length;

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
          running > 0 ? (
            <StatusPill tone="live" dot pulse>
              {running} running
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
                {uncapped} goal{uncapped === 1 ? "" : "s"} running without a spend cap
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

      {/* The reference's Activity Log, carrying what actually happened here. */}
      <TableCard>
        <PanelHeader className="border-b border-edge">
          <PanelTitle icon={<History />}>Recent activity</PanelTitle>
          <Button asChild variant="ghost" size="sm">
            <Link to="/activity">
              See more
              <ArrowRight />
            </Link>
          </Button>
        </PanelHeader>

        {activity.isLoading ? (
          <SkeletonRows rows={5} />
        ) : (activity.data ?? []).length === 0 ? (
          <EmptyState
            icon={<Inbox />}
            title="Nothing has happened yet"
            hint="Runs, questions and goal progress land here."
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH className="w-28">When</TH>
                <TH className="w-24">Kind</TH>
                <TH>What</TH>
              </tr>
            </THead>
            <tbody>
              {[...(activity.data ?? [])]
                .sort((a, b) => b.at.localeCompare(a.at))
                .slice(0, 8)
                .map((entry) => (
                  <TR key={entry.id}>
                    <TD className="whitespace-nowrap text-ink-muted">
                      <span title={entry.at}>{relativeTime(entry.at)}</span>
                    </TD>
                    <TD>
                      <span className="flex items-center gap-1.5 text-ink-muted">
                        <Dot />
                        {KIND_LABEL[entry.kind]}
                      </span>
                    </TD>
                    <TD>
                      <span className="font-medium text-ink">{entry.title}</span>
                      {entry.detail ? (
                        <span className="ml-2 text-ink-muted">{truncate(entry.detail, 90)}</span>
                      ) : null}
                    </TD>
                  </TR>
                ))}
            </tbody>
          </Table>
        )}
      </TableCard>
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

const KIND_LABEL: Record<ActivityEntryDto["kind"], string> = {
  "task-activity": "task",
  session: "session",
  inbox: "inbox",
  goal: "goal",
};

/** The board meter labels every column, including the empty ones. */
function BoardMeter(props: { segments: MeterSegment[] }): React.JSX.Element {
  const total = props.segments.reduce((sum, s) => sum + s.value, 0);
  const fill: Record<string, string> = {
    violet: "bg-data-violet",
    sky: "bg-data-sky",
    amber: "bg-data-amber",
    emerald: "bg-data-emerald",
  };

  return (
    <div className="space-y-2">
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-sunken">
        {total === 0
          ? null
          : props.segments
              .filter((s) => s.value > 0)
              .map((s) => (
                <div
                  key={s.label}
                  className={`h-full rounded-full ${fill[s.accent]}`}
                  style={{ width: `${Math.max((s.value / total) * 100, 2)}%` }}
                />
              ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {props.segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-xs text-ink-muted">
            <span aria-hidden className={`size-1.5 rounded-full ${fill[s.accent]}`} />
            {s.label}
            <span className="tnum font-medium text-ink">{s.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Figure(props: {
  icon: React.ReactNode;
  value: number;
  label: string;
  to: string;
}): React.JSX.Element {
  return (
    <Link
      to={props.to}
      className="rounded-control p-2 transition-colors hover:bg-sunken [&_svg]:size-3.5"
    >
      <dt className="flex items-center gap-1.5 text-xs text-ink-faint">
        {props.icon}
        {props.label}
      </dt>
      <dd className="tnum mt-1 text-[22px] leading-none font-semibold text-ink">{props.value}</dd>
    </Link>
  );
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
