import { useQuery } from "@tanstack/react-query";
import { api, type ActivityEntryDto } from "../api";
import { useActiveProject } from "../hooks/use-project";

const KIND_LABEL: Record<ActivityEntryDto["kind"], string> = {
  "task-activity": "task",
  session: "session",
  inbox: "inbox",
  goal: "goal",
};

export function ActivityPage(): React.JSX.Element {
  const { project } = useActiveProject();
  const projectId = project?.id;

  const activity = useQuery({
    queryKey: ["activity", projectId],
    queryFn: () => api.activity(projectId!, 100),
    enabled: Boolean(projectId),
    refetchInterval: 5000,
  });

  if (!project) {
    return <p className="text-sm text-ink-muted">No project yet. Run `pnpm db:seed`.</p>;
  }

  const entries = [...(activity.data ?? [])].sort((a, b) => b.at.localeCompare(a.at));
  const groups = groupByDay(entries);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-lg font-semibold">Activity</h1>
      {groups.map(([day, dayEntries]) => (
        <section key={day}>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
            {day}
          </h2>
          <ul className="space-y-1.5">
            {dayEntries.map((entry) => (
              <li key={entry.id} className="rounded-sm border border-edge bg-surface-raised p-2.5 text-sm">
                <div className="flex items-center gap-2">
                  <span className="rounded-sm bg-edge px-1.5 py-0.5 text-xs text-ink">
                    {KIND_LABEL[entry.kind]}
                  </span>
                  <span className="machine text-xs text-ink-faint">{entry.at.slice(11, 19)}</span>
                  <span className="font-medium">{entry.title}</span>
                </div>
                {entry.detail ? (
                  <p className="mt-1 whitespace-pre-wrap text-xs text-ink-muted">{entry.detail}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {entries.length === 0 ? <p className="text-sm text-ink-muted">Nothing yet.</p> : null}
    </div>
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
