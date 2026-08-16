import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { api, type ActivityEntryDto } from "../api";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { useProjectGate } from "../hooks/use-project";
import { NoProject, ProjectPending } from "./project-states";

const KIND_LABEL: Record<ActivityEntryDto["kind"], string> = {
  "task-activity": "task",
  session: "session",
  inbox: "inbox",
  goal: "goal",
};

/**
 * The kind of an entry is a category, not a state — a failed session is still
 * kind `session`. So these are the data hues, which the token system reserves
 * for exactly this and forbids from carrying status. Colouring the chip with a
 * signal hue made a failed session render emerald, which is the one thing the
 * One Meaning Rule exists to prevent.
 */
const KIND_ACCENT: Record<ActivityEntryDto["kind"], string> = {
  "task-activity": "bg-data-violet",
  session: "bg-data-sky",
  inbox: "bg-data-amber",
  goal: "bg-data-emerald",
};

export function ActivityPage(): React.JSX.Element {
  const { project, pending, absent } = useProjectGate();
  const projectId = project?.id;

  const activity = useQuery({
    queryKey: ["activity", projectId],
    queryFn: () => api.activity(projectId!, 100),
    enabled: Boolean(projectId),
    refetchInterval: 5000,
  });

  if (absent) {
    return <NoProject />;
  }
  if (pending || !project) {
    return <ProjectPending />;
  }

  const entries = [...(activity.data ?? [])].sort((a, b) => b.at.localeCompare(a.at));
  const groups = groupByDay(entries);

  return (
    <Page width="reading">
      <PageHeader icon={<History />} title="Activity" />

      {activity.isLoading ? (
        <Panel>
          <SkeletonRows rows={6} />
        </Panel>
      ) : null}

      {groups.map(([day, dayEntries]) => (
        <section key={day} className="space-y-2">
          <h2 className="text-[11px] font-medium tracking-[0.06em] text-ink-faint uppercase">
            {formatDay(day)}
          </h2>

          {/*
            A rail with a node per entry: the timeline the reference uses for
            "Recent Activity", which reads as one continuous run rather than as
            a stack of unrelated cards.
          */}
          <Panel className="p-4">
            <ol className="relative space-y-4 before:absolute before:top-1.5 before:bottom-1.5 before:left-[3px] before:w-px before:bg-edge">
              {dayEntries.map((entry) => (
                <li key={entry.id} className="relative pl-5">
                  <span
                    aria-hidden
                    className={`absolute top-1.5 left-0 size-1.5 rounded-full ring-2 ring-panel ${KIND_ACCENT[entry.kind]}`}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="machine text-xs text-ink-faint">{entry.at.slice(11, 19)}</span>
                    <StatusPill tone="neutral">
                      <span
                        aria-hidden
                        className={`size-1.5 rounded-full ${KIND_ACCENT[entry.kind]}`}
                      />
                      {KIND_LABEL[entry.kind]}
                    </StatusPill>
                    <span className="text-[13px] font-medium text-ink">{entry.title}</span>
                  </div>
                  {entry.detail ? (
                    <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap text-ink-muted">
                      {entry.detail}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </Panel>
        </section>
      ))}

      {!activity.isLoading && entries.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<History />}
            title="No activity recorded"
            hint="Session, inbox, and goal activity will appear here."
          />
        </Panel>
      ) : null}
    </Page>
  );
}

function groupByDay(entries: ActivityEntryDto[]): Array<[string, ActivityEntryDto[]]> {
  const groups = new Map<string, ActivityEntryDto[]>();
  for (const entry of entries) {
    const day = entry.at.slice(0, 10);
    const bucket = groups.get(day) ?? [];
    bucket.push(entry);
    groups.set(day, bucket);
  }
  return [...groups.entries()];
}

/** "Today" beats a date the operator has to decode at 2am. */
function formatDay(day: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (day === today) return "Today";
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (day === yesterday) return "Yesterday";
  return day;
}
