import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { InlineError, Skeleton } from "../components/ui/feedback";
import { Panel, PanelHeader, PanelTitle, Well } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";

/**
 * Where this project's code actually is.
 *
 * A project is a row, not a directory — creating one puts nothing on any disk.
 * That is not obvious from a screen full of settings, and the operator who
 * built this app still had to ask, which is a good sign the product should say
 * it rather than the documentation.
 *
 * The panel doubles as the state of the answer: with no repo connected, every
 * agent here works with no code at all, which is exactly the condition that had
 * the librarian and the implementation agent parking questions in the inbox.
 */
export function ProjectCode({ projectId }: { projectId: string }): React.JSX.Element {
  const repos = useQuery({
    queryKey: ["repos", projectId],
    queryFn: () => api.repos(projectId),
  });

  const list = repos.data ?? [];

  return (
    <Panel>
      <PanelHeader className="border-b border-edge">
        <PanelTitle accent="sky">Repositories</PanelTitle>
        {repos.isSuccess && list.length === 0 ? (
          <StatusPill tone="gate">none configured</StatusPill>
        ) : null}
      </PanelHeader>

      <div className="space-y-3 p-4">
        <p className="text-[13px] leading-relaxed text-ink-muted">
          Projects reference remote Git repositories. A{" "}
          <Link to="/repos" className="text-link hover:underline">
            repository
          </Link>{" "}
          configuration defines the remote, branch, mount path, and credentials.
        </p>

        <ol className="space-y-1.5 text-[13px] text-ink-muted">
          <li>1. A session clones authorized repositories into a temporary directory.</li>
          <li>2. The agent makes changes and commits when it has write access.</li>
          <li>3. The directory is deleted when the session ends; only pushed commits remain.</li>
        </ol>

        {/* The skeleton is two name/branch rows, the shape the list settles
            into, so the rail does not resize under the panel below it. */}
        {repos.isPending ? (
          <div className="space-y-1.5" aria-hidden>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </div>
        ) : repos.isError ? (
          <InlineError>Unable to load this project's repositories.</InlineError>
        ) : list.length === 0 ? (
          <Well className="space-y-2.5">
            <p className="text-xs leading-relaxed text-ink-muted">
              No repository is configured. Agents start with an empty workspace and can write only
              to the AgentOS filesystem.
            </p>
            <Button size="sm" asChild>
              <Link to="/repos">
                <Plus />
                Add a repository
              </Link>
            </Button>
          </Well>
        ) : (
          <ul className="space-y-1">
            {list.map((repo) => (
              <li key={repo.id} className="flex items-baseline justify-between gap-2">
                <span className="machine truncate text-xs text-ink">{repo.name}</span>
                <span className="machine shrink-0 text-xs text-ink-faint">
                  {repo.defaultBranch}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="text-xs leading-relaxed text-ink-faint">
          Use Files for persistent project documents that do not belong in a Git repository.
        </p>
      </div>
    </Panel>
  );
}
