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
