import type { GithubInstallationDto, RemoteRepoDto } from "@agentos/shared";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Field, Select } from "../components/ui/form";

export interface RepoSource {
  /** Empty when the operator is entering a remote by hand. */
  installationId: string;
  credentialSecretId: string;
}

/**
 * How this repo authenticates, and — when it is a GitHub App — which repo.
 *
 * With an installation selected the remote URL stops being something to type.
 * GitHub already knows which repositories it granted, so the operator picks one
 * and the URL and default branch come back correct. Typing a remote by hand is
 * how you end up with a repo whose branch is `master` and whose clone fails at
 * 2am inside a container nobody is watching.
 */
export function RepoSourceField({
  projectId,
  installations,
  value,
  onChange,
  onPickRepo,
  secrets,
}: {
  projectId: string;
  installations: GithubInstallationDto[];
  value: RepoSource;
  onChange: (next: RepoSource) => void;
  /** Fired when a remote repository is chosen, to fill the rest of the form. */
  onPickRepo: (repo: RemoteRepoDto) => void;
  secrets: Array<{ id: string; name: string }>;
}): React.JSX.Element {
  const remote = useQuery({
    queryKey: ["github-repositories", projectId, value.installationId],
    queryFn: () => api.githubRepositories(projectId, value.installationId),
    enabled: Boolean(value.installationId),
  });

  return (
    <>
      <Field
        label="Authentication"
        className="sm:col-span-2"
        hint={
          value.installationId
            ? "Each clone mints a token that expires in an hour and reaches only the repositories you granted."
            : "A stored personal access token. Long-lived and as broad as its scopes — prefer a GitHub App."
        }
      >
        {(id) => (
          <Select
            id={id}
            value={value.installationId ? `gh:${value.installationId}` : "secret"}
            onChange={(event) => {
              const picked = event.target.value;
              onChange(
                picked.startsWith("gh:")
                  ? { installationId: picked.slice(3), credentialSecretId: "" }
                  : { installationId: "", credentialSecretId: value.credentialSecretId },
              );
            }}
          >
            {installations.map((installation) => (
              <option key={installation.id} value={`gh:${installation.id}`}>
                GitHub · {installation.accountLogin || "connected account"}
              </option>
            ))}
            <option value="secret">Personal access token</option>
          </Select>
        )}
      </Field>

      {value.installationId ? (
        <Field
          label="Repository"
          className="sm:col-span-2"
          hint={
            remote.isError
              ? "Could not list repositories for that installation."
              : remote.isLoading
                ? "Loading what GitHub granted…"
                : `${(remote.data ?? []).length} available`
          }
        >
          {(id) => (
            <Select
              id={id}
              defaultValue=""
              disabled={remote.isLoading || (remote.data ?? []).length === 0}
              onChange={(event) => {
                const repo = (remote.data ?? []).find(
                  (candidate) => candidate.fullName === event.target.value,
                );
                if (repo) {
                  onPickRepo(repo);
                }
              }}
            >
              <option value="" disabled>
                choose a repository…
              </option>
              {(remote.data ?? []).map((repo) => (
                <option key={repo.fullName} value={repo.fullName}>
                  {repo.fullName}
                  {repo.private ? " (private)" : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : (
        <Field label="Credential" className="sm:col-span-2">
          {(id) => (
            <Select
              id={id}
              value={value.credentialSecretId}
              onChange={(event) =>
                onChange({ installationId: "", credentialSecretId: event.target.value })
              }
            >
              <option value="">no credential…</option>
              {secrets.map((secret) => (
                <option key={secret.id} value={secret.id}>
                  {secret.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
    </>
  );
}
