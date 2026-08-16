import type { CreateMcpConnectionInput, McpConnectionDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Blocks, KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { CreatePanel } from "../components/ui/create-panel";
import { DeleteAction } from "../components/ui/delete-action";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Field, Input, Select } from "../components/ui/form";
import { IconTile, toneFor } from "../components/ui/icon-tile";
import { Meta, MetaRow } from "../components/ui/meta";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { CountChip, StatusPill } from "../components/ui/pill";
import { Table, TableCard, TD, TH, THead, TR } from "../components/ui/table";
import { useProjectGate } from "../hooks/use-project";
import { NoProject, ProjectPending } from "./project-states";

export function McpsPage(): React.JSX.Element {
  const { project, pending, absent } = useProjectGate();
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

  if (absent) {
    return <NoProject />;
  }
  if (pending || !project) {
    return <ProjectPending />;
  }

  const list = connections.data ?? [];

  return (
    <Page>
      <PageHeader
        icon={<Blocks />}
        title="MCP connections"
        meta={list.length > 0 ? <CountChip>{list.length}</CountChip> : undefined}
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
        description="Configure the server and the operations agents may access."
        submitLabel="Create"
        pending={create.isPending}
        disabled={!name || !url}
        incomplete="A name and a server URL are required."
        error={create.isError ? "MCP connection creation failed." : null}
        onSubmit={async () => {
          await create.mutateAsync({
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
          <Field label="Name" required>
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
          <Field
            label="Allowed operations"
            hint="Enter comma-separated operation names. Leave blank to deny all operations."
          >
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
                <option value="">No credential</option>
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
            hint="Add an MCP server, then grant specific operations to the required agents."
            action={
              <Button variant="outline" onClick={() => setCreating(true)}>
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
                <TH>Connection</TH>
                <TH>Allowed operations</TH>
                <TH>Credential</TH>
                <TH aria-label="Actions" />
              </tr>
            </THead>
            <tbody>
              {list.map((connection: McpConnectionDto) => {
                const credential = connection.credentialSecretId
                  ? secrets.data?.find((s) => s.id === connection.credentialSecretId)
                  : undefined;
                return (
                  <TR key={connection.id}>
                    {/* Name over URL in one cell: the URL is what identifies the
                      server, but it is not what the operator is scanning for,
                      and as its own column it truncated to `https://api.…`. */}
                    <TD className="max-w-[20rem]">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <IconTile tone={toneFor(connection.id)} size="sm">
                          <Blocks />
                        </IconTile>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">{connection.name}</p>
                          <p
                            className="machine truncate text-xs text-ink-muted"
                            title={connection.url}
                          >
                            {connection.url}
                          </p>
                        </div>
                      </div>
                    </TD>
                    <TD className="max-w-[20rem]">
                      {connection.allowedOperations.length === 0 ? (
                        <StatusPill tone="neutral">none granted</StatusPill>
                      ) : (
                        // An operation is a category, not a state. These were blue
                        // — the tone this system reserves for idle information and
                        // things that leave the app — so a connection granting six
                        // operations lit up like six live sessions.
                        <span className="flex flex-wrap gap-1">
                          {connection.allowedOperations.map((op) => (
                            <StatusPill key={op} tone="neutral" className="machine">
                              {op}
                            </StatusPill>
                          ))}
                        </span>
                      )}
                    </TD>
                    <TD className="max-w-[12rem]">
                      {connection.credentialSecretId ? (
                        <MetaRow>
                          <Meta
                            icon={<KeyRound />}
                            machine={!credential}
                            title={connection.credentialSecretId}
                          >
                            {credential?.name ?? connection.credentialSecretId}
                          </Meta>
                        </MetaRow>
                      ) : (
                        <span className="text-xs text-ink-faint">none</span>
                      )}
                    </TD>
                    <TD className="w-0 text-right">
                      <DeleteAction
                        what={connection.name}
                        body={
                          <>
                            This connection will be removed from assigned agents in new sessions.
                            The MCP server will not be changed.
                          </>
                        }
                        onDelete={() => api.deleteMcpConnection(project.id, connection.id)}
                        invalidate={[
                          ["mcp-connections", project.id],
                          ["agents", project.id],
                        ]}
                      />
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        </TableCard>
      )}
    </Page>
  );
}
