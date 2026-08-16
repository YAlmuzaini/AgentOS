import type { ProjectDto } from "@agentos/shared";
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { api } from "../api";

const STORAGE_KEY = "agentos.project";

/**
 * Which project the operator is looking at.
 *
 * A module-level store rather than a context, because *every* screen needs the
 * answer and the shell itself needs it before the router mounts. A provider
 * would have to wrap both, and anything rendered outside it would silently read
 * a default — which is the failure mode this whole feature exists to prevent.
 *
 * Persisted to this browser: an operator who switches to `todo-app`, closes the
 * tab, and comes back is still in `todo-app`. Nothing about the selection is
 * sent to the control plane, and nothing about it grants access — the API
 * authorises every request on the operator token regardless of what is picked
 * here.
 */
let selectedId: string | null = readStored();
const listeners = new Set<() => void>();

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private-mode Safari throws on localStorage. The picker still works for
    // the life of the tab; it just does not survive a reload.
    return null;
  }
}

export function selectProject(id: string | null): void {
  selectedId = id;
  try {
    if (id === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, id);
    }
  } catch {
    /* see readStored */
  }
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useSelectedId(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => selectedId,
    () => null,
  );
}

/**
 * Resolves the stored choice against the projects that actually exist.
 *
 * A stored id can outlive its project — deleted from the CLI, or a database
 * reseeded underneath the browser. Falling back to the first project keeps the
 * app usable instead of rendering every screen empty against an id the server
 * has never heard of.
 */
function resolve(projects: ProjectDto[] | undefined, id: string | null): ProjectDto | undefined {
  if (!projects || projects.length === 0) {
    return undefined;
  }
  return projects.find((project) => project.id === id) ?? projects[0];
}

export function useProjects(): {
  projects: ProjectDto[];
  active: ProjectDto | undefined;
  isLoading: boolean;
} {
  const query = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const id = useSelectedId();
  return {
    projects: query.data ?? [],
    active: resolve(query.data, id),
    isLoading: query.isLoading,
  };
}

export function useActiveProject(): {
  project: ProjectDto | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  const query = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const id = useSelectedId();
  return {
    project: resolve(query.data, id),
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
  };
}

/**
 * The three states a page can be in before it has a project, as one answer.
 *
 * Every page used to write this guard itself, and most of them wrote it wrong:
 * they rendered "No project yet — seed one" whenever the project was merely
 * *absent*, which is also what a slow request and a failed one look like. This
 * app has already sent its operator chasing a seeding problem that was actually
 * a rejected token, so a page must not be able to make that mistake by
 * omission.
 *
 * Returns `pending` while the answer is unknown, so the caller renders nothing
 * conclusive; the shell owns the error case for the same query.
 */
export function useProjectGate(): {
  project: ProjectDto | undefined;
  /** True until the project list has genuinely answered. */
  pending: boolean;
  /** True only when the request succeeded and there really is no project. */
  absent: boolean;
} {
  const query = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  const id = useSelectedId();
  return {
    project: resolve(query.data, id),
    pending: query.isPending || query.isError,
    absent: query.isSuccess && !query.data?.[0],
  };
}
