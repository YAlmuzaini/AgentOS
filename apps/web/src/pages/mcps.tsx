import type { CreateMcpConnectionInput, McpConnectionDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Blocks, Plus } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { CreatePanel } from "../components/ui/create-panel";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Field, Input, Select } from "../components/ui/form";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { Table, TableCard, TD, TH, THead, TR } from "../components/ui/table";
import { useActiveProject } from "../hooks/use-project";
import { NoProject } from "./tasks";

export function McpsPage(): React.JSX.Element {
  const { project } = useActiveProject();
  const queryClient = useQueryClient();
  const projectId = project?.id;
  const [creating, setCreating] = useState(false);

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
    onSuccess: () => {
      setCreating(false);
      void queryClient.invalidateQueries({ queryKey: ["mcp-connections", projectId] });
    },
  });

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [operations, setOperations] = useState("");
  const [credentialSecretId, setCredentialSecretId] = useState("");

  if (!project) {
    return <NoProject />;
  }

  const list = connections.data ?? [];

  return (
    <Page>
      <PageHeader
        icon={<Blocks />}
        title="MCP connections"
        meta={list.length > 0 ? `${list.length} connected` : undefined}
        actions={
          <Button variant="solid" onClick={() => setCreating(true)}>
            <Plus />
            New connection
          </Button>
        }
      />

      <CreatePanel
        open={creating}
        onClose={() => setCreating(false)}
        title="New MCP connection"
        description="An agent reaches only the operations listed here — nothing else on the server."
        submitLabel="Create"
        pending={create.isPending}
        disabled={!name || !url}
        error={create.isError ? "Could not create it." : null}
        onSubmit={() => {
          create.mutate({
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            {(id) => (
              <Input id={id} value={name} onChange={(event) => setName(event.target.value)} />
            )}
          </Field>
          <Field label="URL">
            {(id) => (
              <Input
                id={id}
                className="machine"
                placeholder="https://…"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
            )}
          </Field>
          <Field label="Allowed operations" hint="Comma separated. Empty grants nothing.">
            {(id) => (
              <Input
                id={id}
                placeholder="op1, op2"
                value={operations}
                onChange={(event) => setOperations(event.target.value)}
              />
            )}
          </Field>
          <Field label="Credential">
            {(id) => (
              <Select
                id={id}
                value={credentialSecretId}
                onChange={(event) => setCredentialSecretId(event.target.value)}
              >
                <option value="">no credential…</option>
                {(secrets.data ?? []).map((secret) => (
                  <option key={secret.id} value={secret.id}>
                    {secret.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </CreatePanel>

      {connections.isLoading ? (
        <Panel>
          <SkeletonRows />
        </Panel>
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Blocks />}
            title="No MCP connections yet"
            hint="Add one to give agents tools."
            action={
              <Button variant="solid" onClick={() => setCreating(true)}>
                <Plus />
                New connection
              </Button>
            }
          />
        </Panel>
      ) : (
        <TableCard>
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>URL</TH>
                <TH>Allowed operations</TH>
                <TH>Credential</TH>
              </tr>
            </THead>
            <tbody>
              {list.map((connection: McpConnectionDto) => (
                <TR key={connection.id}>
                  <TD className="font-medium">{connection.name}</TD>
                  <TD className="machine max-w-xs truncate text-xs text-ink-muted">
                    {connection.url}
                  </TD>
                  <TD>
                    {connection.allowedOperations.length === 0 ? (
                      <StatusPill tone="neutral">none granted</StatusPill>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {connection.allowedOperations.map((op) => (
                          <StatusPill key={op} tone="idle">
                            {op}
                          </StatusPill>
                        ))}
                      </span>
                    )}
                  </TD>
                  <TD className="text-xs text-ink-faint">
                    {connection.credentialSecretId
                      ? (secrets.data?.find((s) => s.id === connection.credentialSecretId)?.name ??
                        connection.credentialSecretId)
                      : "none"}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </TableCard>
      )}
    </Page>
  );
}
