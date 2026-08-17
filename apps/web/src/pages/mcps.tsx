import type {
  CreateMcpConnectionInput,
  McpConnectionDto,
  UpdateMcpConnectionInput,
} from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Blocks, Download, KeyRound, Pencil, Plus, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { CreatePanel } from "../components/ui/create-panel";
import { DeleteAction } from "../components/ui/delete-action";
import { useConfirm } from "../components/ui/confirm";
import { EmptyState, InlineError, SkeletonRows } from "../components/ui/feedback";
import { Field, Input, Select } from "../components/ui/form";
import { IconTile, toneFor } from "../components/ui/icon-tile";
import { Meta, MetaRow } from "../components/ui/meta";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { CountChip, StatusPill } from "../components/ui/pill";
import { Table, TableCard, TD, TH, THead, TR } from "../components/ui/table";
import { useProjectGate } from "../hooks/use-project";
import { LocalToolNote, LocalToolWarning, McpRisks, McpStateRow } from "./mcp-status";
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

  // Which agents list each connection. This is the difference between
  // "configured" and "granted", and it is the whole default-deny story on this
  // screen — a row nobody lists is a row no session can call.
  const agents = useQuery({
    queryKey: ["agents", projectId],
    queryFn: () => api.agents(projectId!),
    enabled: Boolean(projectId),
  });

  const secrets = useQuery({
    queryKey: ["secrets", projectId],
    queryFn: () => api.secrets(projectId!),
    enabled: Boolean(projectId),
  });

  /**
   * The shipped catalogue, fetched whether or not anything is installed: it is
   * what turns a row called `context7` into "documentation, needs
   * CONTEXT7_API_KEY, talks to mcp.context7.com".
   */
  const catalog = useQuery({
    queryKey: ["mcp-catalog", projectId],
    queryFn: () => api.mcpCatalog(projectId!),
    enabled: Boolean(projectId),
  });

  const installBuiltIns = useMutation({
    mutationFn: () => api.installBuiltInMcp(projectId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["mcp-connections", projectId] }),
  });

  const [editing, setEditing] = useState<McpConnectionDto | null>(null);

  const update = useMutation({
    mutationFn: (input: { id: string; body: UpdateMcpConnectionInput }) =>
      api.updateMcpConnection(projectId!, input.id, input.body),
    onSuccess: () => {
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["mcp-connections", projectId] });
    },
  });

  const verify = useMutation({
    mutationFn: (id: string) => api.verifyMcpConnection(projectId!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["mcp-connections", projectId] }),
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

  const confirm = useConfirm();

  /**
   * Creating a connection grants nothing, so this is one of the safe installs —
   * and the dialog has to say so, because "install nine servers" reads as
   * "give nine servers to my agents" until someone tells you otherwise.
   */
  const confirmInstall = (): void =>
    confirm({
      kind: "warn",
      title: "Install the built-in connections?",
      body: (
        <>
          This adds the MCP servers that ship with AgentOS to this project.{" "}
          <strong className="font-medium text-ink">No agent gains access</strong> — each connection
          is inert until an agent lists it, and a limited environment still has to allow its host.
          A connection you already have under the same name is left untouched, and none of them
          arrives with a credential attached.
        </>
      ),
      confirmLabel: "Install built-ins",
      onConfirm: () => installBuiltIns.mutate(),
    });

  if (absent) {
    return <NoProject />;
  }
  if (pending || !project) {
    return <ProjectPending />;
  }

  const list = connections.data ?? [];
  const seedFor = (name: string) => catalog.data?.find((entry) => entry.slug === name);
  const grantedTo = (id: string) =>
    (agents.data ?? []).filter((agent) => agent.mcpConnectionIds.includes(id)).map((a) => a.name);

  return (
    <Page>
      <PageHeader
        icon={<Blocks />}
        title="MCP connections"
        meta={list.length > 0 ? <CountChip>{list.length}</CountChip> : undefined}
        actions={
          <>
            <Button variant="outline" onClick={confirmInstall} disabled={installBuiltIns.isPending}>
              <Download />
              {installBuiltIns.isPending ? "Installing…" : "Install built-ins"}
            </Button>
            <Button variant="solid" onClick={() => setCreating(true)}>
              <Plus />
              New connection
            </Button>
          </>
        }
      />

      {installBuiltIns.isError ? (
        <InlineError>Unable to install the built-in connections.</InlineError>
      ) : null}

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
            hint="Comma-separated tool names. Leave blank to allow every tool this server exposes."
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

      {/* Editing is how a built-in gets its credential: the catalogue installs
          a narrowed URL with none, and deleting the row to re-add it by hand
          would lose that URL. Name is deliberately not editable — it is the key
          agentos.yml and the installer reconcile on. */}
      <CreatePanel
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing ? `Edit ${editing.name}` : "Edit connection"}
        description="Change where this server lives, which of its tools may be called, and which secret authenticates it."
        submitLabel="Save"
        pending={update.isPending}
        disabled={false}
        error={update.isError ? "Unable to save the connection." : null}
        onSubmit={async () => {
          if (!editing) {
            return;
          }
          await update.mutateAsync({
            id: editing.id,
            body: {
              url: editing.url,
              allowedOperations: editing.allowedOperations,
              credentialSecretId: editing.credentialSecretId,
            },
          });
        }}
      >
        {editing ? (
          <div className="space-y-4">
            <Field label="URL">
              {(id) => (
                <Input
                  id={id}
                  className="machine"
                  value={editing.url}
                  onChange={(event) => setEditing({ ...editing, url: event.target.value })}
                />
              )}
            </Field>
            <Field
              label="Allowed operations"
              hint="Comma-separated tool names. Leave blank to allow every tool this server exposes."
            >
              {(id) => (
                <Input
                  id={id}
                  value={editing.allowedOperations.join(", ")}
                  onChange={(event) =>
                    setEditing({
                      ...editing,
                      allowedOperations: event.target.value
                        .split(",")
                        .map((op) => op.trim())
                        .filter(Boolean),
                    })
                  }
                />
              )}
            </Field>
            <Field
              label="Credential"
              hint={
                seedFor(editing.name)?.credentialEnvVar
                  ? `This server expects ${seedFor(editing.name)!.credentialEnvVar}. Only secrets with the mcp purpose can be attached.`
                  : "Only secrets with the mcp purpose can be attached."
              }
            >
              {(id) => (
                <Select
                  id={id}
                  value={editing.credentialSecretId ?? ""}
                  onChange={(event) =>
                    setEditing({ ...editing, credentialSecretId: event.target.value || null })
                  }
                >
                  <option value="">No credential</option>
                  {(secrets.data ?? [])
                    .filter((secret) => secret.purpose === "mcp")
                    .map((secret) => (
                      <option key={secret.id} value={secret.id}>
                        {secret.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <LocalToolWarning connection={editing} seed={seedFor(editing.name)} />
          </div>
        ) : null}
      </CreatePanel>

      {verify.isError ? (
        <InlineError>Unable to reach that server. Its row records why.</InlineError>
      ) : null}

      {list.length > 0 ? <LocalToolNote /> : null}

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
                <TH>State</TH>
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
                // A shipped connection knows which variable its token belongs
                // in. Saying so here is the difference between "none" meaning
                // "this needs nothing" and "none" meaning "this will fail on
                // its first call".
                const seed = seedFor(connection.name);
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
                    {/* What is true about this row, in the five words that
                        actually differ: cataloged, needs a credential, granted,
                        verified. Only the last is evidence. */}
                    <TD className="max-w-[22rem] space-y-1.5">
                      <McpStateRow
                        connection={connection}
                        seed={seed}
                        grantedTo={grantedTo(connection.id)}
                      />
                      <McpRisks seed={seed} />
                      <LocalToolWarning connection={connection} seed={seed} />
                    </TD>
                    <TD className="max-w-[20rem]">
                      {connection.allowedOperations.length === 0 ? (
                        // Empty is *unrestricted*, not empty: the publisher only
                        // writes a per-tool config when this list is non-empty,
                        // so a blank list leaves every tool enabled. The label
                        // said "none granted", which is the opposite, and it is
                        // the kind of inversion an operator only discovers by
                        // watching an agent call something they thought it could
                        // not reach.
                        <StatusPill tone="neutral" title="Every tool this server exposes is callable by an agent granted this connection.">
                          all tools
                        </StatusPill>
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
                      ) : seed?.credentialEnvVar ? (
                        <span
                          className="text-xs text-ink-faint"
                          title={seed.docs}
                        >
                          needs{" "}
                          <span className="machine text-ink-muted">{seed.credentialEnvVar}</span>
                        </span>
                      ) : seed ? (
                        <span className="text-xs text-ink-faint">none needed</span>
                      ) : (
                        // For a connection the operator wrote, "none" is all we
                        // know — whether the server wants one is theirs to say.
                        <span className="text-xs text-ink-faint">none</span>
                      )}
                    </TD>
                    <TD className="w-0 text-right whitespace-nowrap">
                      {/* Reaching out to a third party with this project's
                          credential is a decision, so it is a button rather
                          than something that happens on load. */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => verify.mutate(connection.id)}
                        disabled={verify.isPending}
                      >
                        <ShieldCheck />
                        {verify.isPending && verify.variables === connection.id
                          ? "Verifying…"
                          : "Verify"}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(connection)}>
                        <Pencil />
                        Edit
                      </Button>
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
