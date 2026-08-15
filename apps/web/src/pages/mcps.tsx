import type { CreateMcpConnectionInput, McpConnectionDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { useActiveProject } from "../hooks/use-project";

export function McpsPage(): React.JSX.Element {
  const { project } = useActiveProject();
  const queryClient = useQueryClient();
  const projectId = project?.id;

  const connections = useQuery({
    queryKey: ["mcp-connections", projectId],
    queryFn: () => api.mcpConnections(projectId!),
    enabled: Boolean(projectId),
  });

  const secrets = useQuery({
    queryKey: ["secrets", projectId],
    queryFn: () => api.secrets(projectId!),
    enabled: Boolean(projectId),
  });

  const create = useMutation({
    mutationFn: (body: CreateMcpConnectionInput) => api.createMcpConnection(projectId!, body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["mcp-connections", projectId] }),
  });

  if (!project) {
    return <p className="text-sm text-ink-muted">No project yet. Run `pnpm db:seed`.</p>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">MCP connections</h1>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
            <tr>
              <th className="py-2">Name</th>
              <th>URL</th>
              <th>Allowed operations</th>
              <th>Credential</th>
            </tr>
          </thead>
          <tbody>
            {(connections.data ?? []).map((connection: McpConnectionDto) => (
              <tr key={connection.id} className="border-t border-edge">
                <td className="py-2">{connection.name}</td>
                <td className="machine text-xs text-ink-muted">{connection.url}</td>
                <td className="text-xs text-ink-muted">
                  {connection.allowedOperations.join(", ") || "—"}
                </td>
                <td className="text-xs text-ink-faint">
                  {connection.credentialSecretId
                    ? secrets.data?.find((s) => s.id === connection.credentialSecretId)?.name ??
                      connection.credentialSecretId
                    : "none"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {connections.data?.length === 0 ? (
          <p className="py-2 text-sm text-ink-muted">
            No MCP connections yet. Add one to give agents tools.
          </p>
        ) : null}
      </div>

      <CreateMcpForm
        secrets={secrets.data ?? []}
        onCreate={(body) => create.mutate(body)}
      />
    </div>
  );
}

function CreateMcpForm(props: {
  secrets: Array<{ id: string; name: string }>;
  onCreate: (body: CreateMcpConnectionInput) => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [operations, setOperations] = useState("");
  const [credentialSecretId, setCredentialSecretId] = useState("");

  return (
    <form
      className="grid gap-2 rounded-md border border-edge bg-surface-raised p-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name || !url) return;
        props.onCreate({
          name,
          url,
          allowedOperations: operations
            .split(",")
            .map((op) => op.trim())
            .filter(Boolean),
          credentialSecretId: credentialSecretId || null,
        });
        setName("");
        setUrl("");
        setOperations("");
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
        placeholder="https://…"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
      />
      <input
        className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
        placeholder="op1, op2"
        value={operations}
        onChange={(event) => setOperations(event.target.value)}
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
