import { SECRET_PURPOSES, type CreateSecretRefInput, type SecretRefDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { useActiveProject } from "../hooks/use-project";

export function SecretsPage(): React.JSX.Element {
  const { project } = useActiveProject();
  const queryClient = useQueryClient();
  const projectId = project?.id;

  const secrets = useQuery({
    queryKey: ["secrets", projectId],
    queryFn: () => api.secrets(projectId!),
    enabled: Boolean(projectId),
  });

  const create = useMutation({
    mutationFn: (body: CreateSecretRefInput) => api.createSecret(projectId!, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["secrets", projectId] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSecret(projectId!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["secrets", projectId] }),
  });

  if (!project) {
    return <p className="text-sm text-ink-muted">No project yet. Run `pnpm db:seed`.</p>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Secrets</h1>
      <p className="text-sm text-ink-muted">
        References only — values are never shown here or returned by the API.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
            <tr>
              <th className="py-2">Name</th>
              <th>Provider ref</th>
              <th>Purpose</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(secrets.data ?? []).map((secret: SecretRefDto) => (
              <tr key={secret.id} className="border-t border-edge">
                <td className="py-2">{secret.name}</td>
                <td className="machine text-xs text-ink-muted">{secret.providerRef}</td>
                <td className="text-ink-muted">{secret.purpose}</td>
                <td>
                  {secret.resolvable ? (
                    <span className="text-xs text-live">resolved</span>
                  ) : (
                    <span className="text-xs text-danger">MISSING</span>
                  )}
                </td>
                <td>
                  <button
                    className="rounded-sm bg-surface-raised px-2 py-1 text-xs text-danger"
                    onClick={() => remove.mutate(secret.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {secrets.data?.length === 0 ? (
          <p className="py-2 text-sm text-ink-muted">
            No secrets yet. Add one to let agents authenticate.
          </p>
        ) : null}
      </div>

      <CreateSecretForm onCreate={(body) => create.mutate(body)} />
    </div>
  );
}

function CreateSecretForm(props: {
  onCreate: (body: CreateSecretRefInput) => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [providerRef, setProviderRef] = useState("");
  const [purpose, setPurpose] = useState<CreateSecretRefInput["purpose"]>("env");

  return (
    <form
      className="grid gap-2 rounded-md border border-edge bg-surface-raised p-3 md:grid-cols-[1fr_1fr_auto_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name || !providerRef) return;
        props.onCreate({ name, providerRef, purpose });
        setName("");
        setProviderRef("");
      }}
    >
      <input
        className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
        placeholder="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <input
        className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
        placeholder="Provider ref (e.g. env var name)"
        value={providerRef}
        onChange={(event) => setProviderRef(event.target.value)}
      />
      <select
        className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
        value={purpose}
        onChange={(event) => setPurpose(event.target.value as CreateSecretRefInput["purpose"])}
      >
        {SECRET_PURPOSES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <button className="rounded-sm bg-edge px-3 py-1.5 text-sm hover:bg-edge-strong" type="submit">
        Create
      </button>
    </form>
  );
}
