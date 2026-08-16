import type { ActivityEntryDto } from "../api";
import { ArrowRight, History, Inbox } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "../components/ui/button";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Panel, PanelHeader, PanelTitle } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { exactTime } from "../components/ui/time";
import { relativeTime } from "../lib/time";
import { KIND_ACCENT, KIND_LABEL } from "./activity";
import { truncate } from "./dashboard-figures";

/**
 * The overview's recent-activity rail.
 *
 * Takes its rows as a prop: the page owns the fetch, this only renders. That
 * keeps the overview readable as a set of numbers rather than a wall of table.
 *
 * It is the same spine-and-dot timeline the Activity screen and the agent's
 * own session rail use, rather than a third shape for the same data. A table
 * gave "what happened here" three ruled columns and a header band, which reads
 * as a report to be audited; the rail reads as one run of events, which is what
 * it is. The vocabulary — the label and the category hue — is imported rather
 * than restated, so an `inbox` entry is amber on every screen that shows one.
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
  const recent = [...entries].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);

  return (
    <Panel>
      <PanelHeader className="border-b border-edge">
        <PanelTitle icon={<History />}>Recent activity</PanelTitle>
        <Button asChild variant="ghost" size="sm">
          <Link to="/activity">
            See more
            <ArrowRight />
          </Link>
        </Button>
      </PanelHeader>

      {loading ? (
        <SkeletonRows rows={5} />
      ) : recent.length === 0 ? (
        <EmptyState
          icon={<Inbox />}
          title="No recent activity"
          hint="Session, inbox, and goal activity will appear here."
        />
      ) : (
        <ol className="relative space-y-4 p-4 before:absolute before:top-6 before:bottom-6 before:left-[19px] before:w-px before:bg-edge">
          {recent.map((entry) => (
            <li key={entry.id} className="relative min-w-0 pl-5">
              {/* A kind is a category, so the node is a data hue and never a
                  signal one — a failed session is still kind `session`. */}
              <span
                aria-hidden
                className={`absolute top-1.5 left-0 size-1.5 rounded-full ring-2 ring-panel ${KIND_ACCENT[entry.kind]}`}
              />
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone="neutral">
                  <span aria-hidden className={`size-1.5 rounded-full ${KIND_ACCENT[entry.kind]}`} />
                  {KIND_LABEL[entry.kind]}
                </StatusPill>
                <span className="min-w-0 text-[13px] font-medium break-words text-ink">
                  {entry.title}
                </span>
                {/* "Is this recent?" is the question the overview is being
                    asked; the exact stamp is on hover for the moment it is
                    being correlated against a log somewhere else. */}
                <span className="ml-auto shrink-0 text-xs text-ink-faint" title={exactTime(entry.at)}>
                  {relativeTime(entry.at)}
                </span>
              </div>
              {entry.detail ? (
                <p className="mt-0.5 text-xs leading-relaxed break-words text-ink-muted">
                  {truncate(entry.detail, 120)}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
