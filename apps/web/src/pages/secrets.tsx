import type { EnvBindingDto } from "@agentos/shared";
import { SECRET_PURPOSES, type CreateSecretRefInput, type SecretRefDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { useConfirm } from "../components/ui/confirm";
import { CreatePanel } from "../components/ui/create-panel";
import { EmptyState, InlineError, SkeletonRows } from "../components/ui/feedback";
import { Field, Input, Select } from "../components/ui/form";
import { IconTile, toneFor } from "../components/ui/icon-tile";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { CountChip, StatusPill } from "../components/ui/pill";
import { Table, TableCard, TD, TH, THead, TR } from "../components/ui/table";
import { useProjectGate } from "../hooks/use-project";
import { NoProject, ProjectPending } from "./project-states";

export function SecretsPage(): React.JSX.Element {
  const { project, pending, absent } = useProjectGate();
  const queryClient = useQueryClient();
  const projectId = project?.id;
  const [creating, setCreating] = useState(false);
  const confirm = useConfirm();
  // Deleting a secret does not merely break the things using it: the
  // environment-variable bindings that reference it are removed by a cascading
  // foreign key, taking their variable names and host restrictions with them.
  // The confirmation has to name them, because nothing else will.
  const bindings = useQuery({
    queryKey: ["env-bindings", projectId],
    queryFn: () => api.envBindings(projectId!),
    enabled: Boolean(projectId),
  });

  const secrets = useQuery({
    queryKey: ["secrets", projectId],
    queryFn: () => api.secrets(projectId!),
    enabled: Boolean(projectId),
  });

  const create = useMutation({
    mutationFn: (body: CreateSecretRefInput) => api.createSecret(projectId!, body),
    onSuccess: () => {
      setCreating(false);
      void queryClient.invalidateQueries({ queryKey: ["secrets", projectId] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSecret(projectId!, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["secrets", projectId] }),
  });

  const [name, setName] = useState("");
  const [providerRef, setProviderRef] = useState("");
  const [purpose, setPurpose] = useState<CreateSecretRefInput["purpose"]>("env");

  if (absent) {
    return <NoProject />;
  }
  if (pending || !project) {
    return <ProjectPending />;
  }

  const list = secrets.data ?? [];
  const missing = list.filter((secret) => !secret.resolvable).length;

  return (
    <Page>
      <PageHeader
        icon={<KeyRound />}
        title="Secrets"
        meta={list.length > 0 ? <CountChip>{list.length}</CountChip> : undefined}
        actions={
          <>
            {/* The one fact worth interrupting the operator with: a reference
                the deployment cannot resolve is a credential that will fail
                inside a container nobody is watching. */}
            {missing > 0 ? (
              <StatusPill tone="danger" dot>
                {missing} missing
              </StatusPill>
            ) : null}
            <Button variant="solid" onClick={() => setCreating(true)}>
              <Plus />
              New secret
            </Button>
          </>
        }
      />

      <p className="text-[13px] text-ink-muted">
        AgentOS stores secret references only. Secret values are never displayed or returned by the
        API.
      </p>

      {remove.isError ? <InlineError>Unable to delete the secret reference.</InlineError> : null}

      <CreatePanel
        open={creating}
        onClose={() => setCreating(false)}
        title="New secret"
        description="Reference a secret already available to this deployment."
        submitLabel="Create"
        pending={create.isPending}
        disabled={!name || !providerRef}
        error={create.isError ? "Secret reference creation failed." : null}
        onSubmit={async () => {
          await create.mutateAsync({ name, providerRef, purpose });
          setName("");
          setProviderRef("");
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name">
            {(id) => (
              <Input id={id} value={name} onChange={(event) => setName(event.target.value)} />
            )}
          </Field>
          <Field label="Provider reference" hint="For example, the environment variable name.">
            {(id) => (
              <Input
                id={id}
                className="machine"
                value={providerRef}
                onChange={(event) => setProviderRef(event.target.value)}
              />
            )}
          </Field>
          <Field label="Purpose">
            {(id) => (
              <Select
                id={id}
                value={purpose}
                onChange={(event) =>
                  setPurpose(event.target.value as CreateSecretRefInput["purpose"])
                }
              >
                {SECRET_PURPOSES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </CreatePanel>

      {secrets.isLoading ? (
        <Panel>
          <SkeletonRows />
        </Panel>
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<KeyRound />}
            title="No secrets yet"
            hint="Add a secret reference for repository, MCP, or environment-variable credentials."
            action={
              <Button variant="outline" onClick={() => setCreating(true)}>
                <Plus />
                New secret
              </Button>
            }
          />
        </Panel>
      ) : (
        <TableCard>
          <Table>
            <THead>
              <tr>
                <TH>Secret</TH>
                <TH>Purpose</TH>
                <TH>Status</TH>
                <TH className="w-0" />
              </tr>
            </THead>
            <tbody>
              {list.map((secret: SecretRefDto) => (
                <TR key={secret.id}>
                  {/* The provider reference is the copyable half of a secret's
                      identity, so it belongs under the name rather than in a
                      column the eye reaches before it knows what it is reading. */}
                  <TD className="max-w-[20rem]">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <IconTile tone={toneFor(secret.id)} size="sm">
                        <KeyRound />
                      </IconTile>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{secret.name}</p>
                        <p
                          className="machine truncate text-xs text-ink-muted"
                          title={secret.providerRef}
                        >
                          {secret.providerRef}
                        </p>
                      </div>
                    </div>
                  </TD>
                  {/* A purpose is a category. It gets the neutral pill. */}
                  <TD>
                    <StatusPill tone="neutral">{secret.purpose}</StatusPill>
                  </TD>
                  <TD>
                    {secret.resolvable ? (
                      <StatusPill tone="live">resolved</StatusPill>
                    ) : (
                      <StatusPill tone="danger" dot>
                        missing
                      </StatusPill>
                    )}
                  </TD>
                  <TD className="w-0 text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${secret.name}`}
                      title={`Delete ${secret.name}`}
                      className="text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger"
                      onClick={() =>
                        confirm({
                          kind: "destroy",
                          title: `Delete “${secret.name}”?`,
                          body: (
                            <>
                              Agents, repositories, and MCP connections using this credential will
                              no longer authenticate.
                              {boundKeys(bindings.data, secret.id).length > 0 ? (
                                <>
                                  {" "}
                                  This also deletes the environment variable
                                  {boundKeys(bindings.data, secret.id).length === 1 ? " " : "s "}
                                  <span className="machine">
                                    {boundKeys(bindings.data, secret.id).join(", ")}
                                  </span>{" "}
                                  and its host restrictions.
                                </>
                              ) : null}{" "}
                              This cannot be undone.
                            </>
                          ),
                          confirmLabel: "Delete secret",
                          onConfirm: () => remove.mutate(secret.id),
                        })
                      }
                    >
                      <Trash2 />
                    </Button>
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

/** The environment variables a cascading delete would take with the secret. */
function boundKeys(bindings: EnvBindingDto[] | undefined, secretId: string): string[] {
  return (bindings ?? []).filter((binding) => binding.secretId === secretId).map((b) => b.key);
}
