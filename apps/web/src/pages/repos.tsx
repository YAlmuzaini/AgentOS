import type { CreateRepoInput, RepoDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { useActiveProject } from "../hooks/use-project";

export function ReposPage(): React.JSX.Element {
  const { project } = useActiveProject();
  const queryClient = useQueryClient();
  const projectId = project?.id;

  const repos = useQuery({
    queryKey: ["repos", projectId],
    queryFn: () => api.repos(projectId!),
    enabled: Boolean(projectId),
  });

  const secrets = useQuery({
    queryKey: ["secrets", projectId],
    queryFn: () => api.secrets(projectId!),
    enabled: Boolean(projectId),
  });

  const create = useMutation({
    mutationFn: (body: CreateRepoInput) => api.createRepo(projectId!, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["repos", projectId] }),
  });

  if (!project) {
    return <p className="text-sm text-ink-muted">No project yet. Run `pnpm db:seed`.</p>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Repos</h1>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
            <tr>
              <th className="py-2">Name</th>
              <th>Remote</th>
              <th>Mount path</th>
              <th>Branch</th>
              <th>Credential</th>
            </tr>
          </thead>
          <tbody>
            {(repos.data ?? []).map((repo: RepoDto) => (
              <tr key={repo.id} className="border-t border-edge">
                <td className="py-2">{repo.name}</td>
                <td className="max-w-xs truncate machine text-xs text-ink-muted">
                  {repo.remoteUrl}
                </td>
                <td className="machine text-xs text-ink-muted">{repo.mountPath}</td>
                <td className="text-ink-muted">{repo.defaultBranch}</td>
                <td className="text-xs text-ink-faint">
                  {repo.credentialSecretId
                    ? secrets.data?.find((s) => s.id === repo.credentialSecretId)?.name ??
                      repo.credentialSecretId
                    : "none"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {repos.data?.length === 0 ? (
          <p className="py-2 text-sm text-ink-muted">No repos yet. Add one for agents to work in.</p>
        ) : null}
      </div>

      <CreateRepoForm secrets={secrets.data ?? []} onCreate={(body) => create.mutate(body)} />
    </div>
  );
}

function CreateRepoForm(props: {
  secrets: Array<{ id: string; name: string }>;
  onCreate: (body: CreateRepoInput) => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [mountPath, setMountPath] = useState("/repo");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [credentialSecretId, setCredentialSecretId] = useState("");

  return (
    <form
      className="grid gap-2 rounded-md border border-edge bg-surface-raised p-3 md:grid-cols-[1fr_1fr_1fr_auto_1fr_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name || !remoteUrl || !mountPath) return;
        props.onCreate({
          name,
          remoteUrl,
          mountPath,
          defaultBranch: defaultBranch || "main",
          credentialSecretId: credentialSecretId || null,
        });
        setName("");
        setRemoteUrl("");
        setMountPath("/repo");
        setDefaultBranch("main");
        setCredentialSecretId("");
      }}
    >
      <input
        className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
        placeholder="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <input
        className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm machine"
        placeholder="https://github.com/…"
        value={remoteUrl}
        onChange={(event) => setRemoteUrl(event.target.value)}
      />
      <input
        className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm machine"
        placeholder="/mount/path"
        value={mountPath}
        onChange={(event) => setMountPath(event.target.value)}
      />
      <input
        className="w-24 rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
        placeholder="main"
        value={defaultBranch}
        onChange={(event) => setDefaultBranch(event.target.value)}
      />
      <select
        className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
        value={credentialSecretId}
        onChange={(event) => setCredentialSecretId(event.target.value)}
      >
        <option value="">no credential…</option>
        {props.secrets.map((secret) => (
          <option key={secret.id} value={secret.id}>
            {secret.name}
          </option>
        ))}
      </select>
      <button className="rounded-sm bg-edge px-3 py-1.5 text-sm hover:bg-edge-strong" type="submit">
        Create
      </button>
    </form>
  );
}
