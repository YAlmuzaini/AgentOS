import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "../api";
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
        <PanelTitle accent="sky">Where the code lives</PanelTitle>
        {repos.isSuccess && list.length === 0 ? (
          <StatusPill tone="gate">no repo</StatusPill>
        ) : null}
      </PanelHeader>

      <div className="space-y-3 p-4">
        <p className="text-[13px] leading-relaxed text-ink-muted">
          Creating a project does not create a folder anywhere. Code lives in git, and a{" "}
          <Link to="/repos" className="text-link hover:underline">
            repo
          </Link>{" "}
          here is a pointer to a remote plus the credential to reach it — never a copy.
        </p>

        <ol className="space-y-1.5 text-[13px] text-ink-muted">
          <li>1. A session starts and clones the granted repos into a throwaway directory.</li>
          <li>2. The agent works there, and commits if it has git-write.</li>
          <li>3. The directory is destroyed. What survives is what was pushed.</li>
        </ol>

        {repos.isSuccess && list.length === 0 ? (
          <Well className="space-y-1">
            <p className="text-xs leading-relaxed text-ink-muted">
              No repo is connected, so agents here start with an empty workspace and can only write
              to the agent filesystem. Add one on{" "}
              <Link to="/repos" className="text-link hover:underline">
                Repos
              </Link>
              , then grant it to an agent.
            </p>
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
          The agent filesystem under Files is for specs, plans and the wiki — the things that have to
          outlive a container but do not belong in a commit.
        </p>
      </div>
    </Panel>
  );
}
