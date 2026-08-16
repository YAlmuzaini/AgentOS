import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { api, ApiError, type ActivityEntryDto } from "../api";
import { EmptyState, InlineError, SkeletonRows } from "../components/ui/feedback";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { CountChip, StatusPill } from "../components/ui/pill";
import { useProjectGate } from "../hooks/use-project";
import { NoProject, ProjectPending } from "./project-states";
import { reflow } from "../lib/prose";

/**
 * Exported because the overview's rail renders the same entries in the same
 * two vocabularies. They were declared twice, which is how the same `inbox`
 * entry ends up amber on one screen and sky on the other.
 */
export const KIND_LABEL: Record<ActivityEntryDto["kind"], string> = {
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
export const KIND_ACCENT: Record<ActivityEntryDto["kind"], string> = {
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
    /*
      Full width, like every other screen. `reading` centred this in a 768px
      strip with half the sheet blank beside it, which made Activity look like
      a different product from the page the operator arrived from. A timeline
      does need a measure — but the measure belongs on the prose inside a row,
      not on the whole screen, so the row below gives the stamp a column of its
      own and clamps only the detail text.
    */
    <Page>
      <PageHeader
        icon={<History />}
        title="Activity"
        meta={entries.length > 0 ? <CountChip>{entries.length}</CountChip> : undefined}
      />

      {/* A feed that cannot reach the server must say so. Rendering the empty
          state instead claims nothing has happened, which is a different and
          wrong statement. */}
      {activity.isError ? (
        <InlineError>
          {activity.error instanceof ApiError
            ? activity.error.message
            : "Unable to load activity."}
        </InlineError>
      ) : null}

      {activity.isLoading ? (
        <Panel>
          <SkeletonRows rows={6} />
        </Panel>
      ) : null}

      {groups.map(([day, dayEntries]) => (
        <section key={day} className="space-y-2">
          {/* The 11px uppercase label step, on a real heading so the feed has
              an outline a screen reader can move through. */}
          <div className="flex items-center gap-2">
            <h2 className="text-[11px] font-medium tracking-[0.06em] text-ink-faint uppercase">
              {formatDay(day)}
            </h2>
            <CountChip>{dayEntries.length}</CountChip>
          </div>

          {/*
            A rail with a node per entry: the timeline the reference uses for
            "Recent Activity", which reads as one continuous run rather than as
            a stack of unrelated cards.

            The stamp sits in its own left column so the nodes, the times and
            the titles each form a straight edge down the day. Inline, the
            title started at a different x on every row — which is exactly the
            ragged effect that made this screen need a narrow measure to look
            tidy in the first place.
          */}
          <Panel className="divide-y divide-edge">
            <ol>
              {dayEntries.map((entry) => (
                <li
                  key={entry.id}
                  className="grid grid-cols-1 gap-x-3 border-b border-edge px-4 py-3 transition-colors last:border-0 hover:bg-sunken/50 sm:grid-cols-[4.5rem_1fr]"
                >
                  <span className="machine tnum hidden self-start text-xs leading-5 text-ink-faint sm:block">
                    {entry.at.slice(11, 19)}
                  </span>
                  {/* No separate node beside the pill: the pill already carries
                      the category dot, and two identical dots 6px apart is the
                      same fact drawn twice. The spine went with it — a spine
                      earns its keep in the 340px overview rail, where the rows
                      are stacked tight; at full width the time column is what
                      makes the day read as one run. */}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone="neutral">
                        <span
                          aria-hidden
                          className={`size-1.5 rounded-full ${KIND_ACCENT[entry.kind]}`}
                        />
                        {KIND_LABEL[entry.kind]}
                      </StatusPill>
                      {/* Below sm the stamp has no column, so it rejoins the
                          line — beside the pill rather than pushed right with
                          `ml-auto`, which dropped it onto the second line the
                          moment a title wrapped and left it floating over the
                          detail text as if it belonged to it. */}
                      <span className="machine tnum shrink-0 text-xs text-ink-faint sm:hidden">
                        {entry.at.slice(11, 19)}
                      </span>
                      <span className="min-w-0 text-[13px] font-medium break-words text-ink">
                        {entry.title}
                      </span>
                    </div>
                    {entry.detail ? (
                      // An agent's own detail line can be a stack trace. It is
                      // held to a readable measure rather than run to the full
                      // width of a desk monitor, and stops at ten lines so one
                      // loud entry cannot bury the day under it.
                      <p className="mt-1 line-clamp-[10] max-w-prose text-xs leading-relaxed break-words whitespace-pre-wrap text-ink-muted">
                        {reflow(entry.detail)}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </section>
      ))}

      {!activity.isLoading && !activity.isError && entries.length === 0 ? (
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
