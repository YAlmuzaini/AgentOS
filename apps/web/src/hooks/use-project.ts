import type { ProjectDto } from "@agentos/shared";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

/**
 * Single operator, so the active project is simply the first one. A project
 * picker lands with YAML-as-code in Phase 6, when more than one is expected.
 */
export function useActiveProject(): {
  project: ProjectDto | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  const query = useQuery({ queryKey: ["projects"], queryFn: api.projects });
  return {
    project: query.data?.[0],
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
  return {
    project: query.data?.[0],
    pending: query.isPending || query.isError,
    absent: query.isSuccess && !query.data?.[0],
  };
}
