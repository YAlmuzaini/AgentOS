import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CornerDownLeft, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { NAV } from "../../app/nav";
import { useActiveProject } from "../../hooks/use-project";
import { cn } from "../../lib/cn";
import { StatusPill } from "./pill";

/**
 * ⌘K search over everything the control plane already knows about.
 *
 * The sidebar previously showed a search-shaped control with ⌘K chips that was
 * really a link to the activity feed — an affordance that promised something
 * the app did not do. This searches the loaded data (destinations, tasks,
 * agents, goals, templates, sessions) and navigates to it.
 */
interface Hit {
  id: string;
  group: string;
  label: string;
  hint?: string;
  badge?: string;
  to: string;
}

export function CommandPalette(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const { project } = useActiveProject();
  const projectId = project?.id;
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Only fetched while the palette is open, so this costs nothing at rest.
  const enabled = props.open && Boolean(projectId);
  const tasks = useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => api.tasks(projectId!),
    enabled,
  });
  const agents = useQuery({
    queryKey: ["agents", projectId],
    queryFn: () => api.agents(projectId!),
    enabled,
  });
  const goals = useQuery({
    queryKey: ["goals", projectId],
    queryFn: () => api.goals(projectId!),
    enabled,
  });
  const templates = useQuery({
    queryKey: ["templates", projectId],
    queryFn: () => api.templates(projectId!),
    enabled,
  });
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: api.sessions,
    enabled: props.open,
  });

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase();
    const all: Hit[] = [];

    for (const group of NAV) {
      for (const item of group.items) {
        all.push({
          id: `nav:${item.to}`,
          group: "Go to",
          label: item.label,
          to: item.to,
        });
      }
    }
    all.push({ id: "nav:/settings", group: "Go to", label: "Settings", to: "/settings" });

    for (const task of tasks.data ?? []) {
      all.push({
        id: `task:${task.id}`,
        group: "Tasks",
        label: task.name,
        badge: task.status,
        hint: task.approvalGate ? "approval gate" : undefined,
        to: "/tasks",
      });
    }
    for (const agent of agents.data ?? []) {
      all.push({
        id: `agent:${agent.id}`,
        group: "Agents",
        label: agent.title,
        hint: agent.name,
        to: "/agents",
      });
    }
    for (const goal of goals.data ?? []) {
      all.push({
        id: `goal:${goal.id}`,
        group: "Goals",
        label: goal.title,
        badge: goal.dodApproved ? goal.status : "awaiting approval",
        to: "/goals",
      });
    }
    for (const template of templates.data ?? []) {
      all.push({
        id: `template:${template.id}`,
        group: "Templates",
        label: template.name,
        hint: `${template.steps.length} steps`,
        to: "/templates",
      });
    }
    for (const session of sessions.data ?? []) {
      all.push({
        id: `session:${session.id}`,
        group: "Sessions",
        label: session.id.slice(0, 8),
        badge: session.status,
        to: "/sessions",
      });
    }

    if (!q) {
      // Resting state is the destinations, not a dump of every row.
      return all.filter((hit) => hit.group === "Go to");
    }
    return all
      .filter(
        (hit) =>
          hit.label.toLowerCase().includes(q) ||
          (hit.hint ?? "").toLowerCase().includes(q) ||
          hit.group.toLowerCase().includes(q),
      )
      .slice(0, 40);
  }, [query, tasks.data, agents.data, goals.data, templates.data, sessions.data]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    if (!props.open) {
      setQuery("");
      setCursor(0);
    }
  }, [props.open]);

  const go = (hit: Hit): void => {
    props.onOpenChange(false);
    void navigate({ to: hit.to });
  };

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[65] bg-overlay" />
        <Dialog.Content
          className="rise fixed top-[12vh] left-1/2 z-[66] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-panel border border-edge bg-panel shadow-pop outline-none"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setCursor((c) => Math.min(c + 1, hits.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (event.key === "Enter" && hits[cursor]) {
              event.preventDefault();
              go(hits[cursor]);
            }
          }}
        >
          <Dialog.Title className="sr-only">Search</Dialog.Title>
          <div className="flex items-center gap-2.5 border-b border-edge px-4">
            <Search className="size-4 shrink-0 text-ink-faint" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tasks, agents, goals, templates, sessions…"
              className="h-12 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
            />
          </div>

          <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1.5">
            {hits.length === 0 ? (
              <p className="px-3 py-8 text-center text-[13px] text-ink-faint">
                Nothing matches “{query}”.
              </p>
            ) : (
              hits.map((hit, index) => {
                const first = index === 0 || hits[index - 1]!.group !== hit.group;
                return (
                  <div key={hit.id}>
                    {first ? (
                      <p className="px-2.5 pt-3 pb-1 text-[11px] font-medium tracking-[0.06em] text-ink-faint uppercase">
                        {hit.group}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => go(hit)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-left text-[13px]",
                        index === cursor ? "bg-sunken text-ink" : "text-ink-muted",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{hit.label}</span>
                      {hit.hint ? (
                        <span className="machine shrink-0 text-xs text-ink-faint">{hit.hint}</span>
                      ) : null}
                      {hit.badge ? <StatusPill tone="neutral">{hit.badge}</StatusPill> : null}
                      {index === cursor ? (
                        <CornerDownLeft className="size-3.5 shrink-0 text-ink-faint" />
                      ) : null}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Binds ⌘K / Ctrl+K anywhere in the app. */
export function useCommandPalette(): {
  open: boolean;
  setOpen: (open: boolean) => void;
} {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { open, setOpen };
}
