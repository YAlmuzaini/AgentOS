import type { ActivityEntryDto } from "../api";
import { ArrowRight, History, Inbox } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "../components/ui/button";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { PanelHeader, PanelTitle } from "../components/ui/panel";
import { Dot, StatusPill } from "../components/ui/pill";
import { Table, TableCard, TD, TH, THead, TR } from "../components/ui/table";
import { relativeTime } from "../lib/time";
import { truncate } from "./dashboard-figures";

const KIND_LABEL: Record<ActivityEntryDto["kind"], string> = {
  "task-activity": "task",
  session: "session",
  inbox: "inbox",
  goal: "goal",
};

/**
 * The overview's recent-activity rail.
 *
 * Takes its rows as a prop: the page owns the fetch, this only renders. That
 * keeps the overview readable as a set of numbers rather than a wall of table.
 */
export function ActivityFeed({
  entries,
  loading,
}: {
  entries: ActivityEntryDto[];
  /** From the parent's query. Hardcoding `false` made a slow load read as
   *  "nothing has happened yet", which is a different and wrong statement. */
  loading: boolean;
}): React.JSX.Element {
  const activity = { data: entries, isLoading: loading };
  return (
    <>
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
            title="No recent activity"
            hint="Session, inbox, and goal activity will appear here."
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH className="w-28">When</TH>
                <TH className="w-24">Kind</TH>
                <TH>Activity</TH>
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
    </>
  );
}
