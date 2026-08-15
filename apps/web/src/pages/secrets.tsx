import { SECRET_PURPOSES, type CreateSecretRefInput, type SecretRefDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { useConfirm } from "../components/ui/confirm";
import { CreatePanel } from "../components/ui/create-panel";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Field, Input, Select } from "../components/ui/form";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { Table, TableCard, TD, TH, THead, TR } from "../components/ui/table";
import { useActiveProject } from "../hooks/use-project";
import { NoProject } from "./tasks";

export function SecretsPage(): React.JSX.Element {
  const { project } = useActiveProject();
  const queryClient = useQueryClient();
  const projectId = project?.id;
  const [creating, setCreating] = useState(false);
  const confirm = useConfirm();

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

  if (!project) {
    return <NoProject />;
  }

  const list = secrets.data ?? [];
  const missing = list.filter((secret) => !secret.resolvable).length;

  return (
    <Page>
      <PageHeader
        icon={<KeyRound />}
        title="Secrets"
        actions={
          <>
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
        References only — values are never shown here or returned by the API.
      </p>

      <CreatePanel
        open={creating}
        onClose={() => setCreating(false)}
        title="New secret"
        description="A pointer to a value the deployment already holds."
        submitLabel="Create"
        pending={create.isPending}
        disabled={!name || !providerRef}
        error={create.isError ? "Could not create it." : null}
        onSubmit={() => {
          create.mutate({ name, providerRef, purpose });
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
          <Field label="Provider ref" hint="e.g. the env var name">
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
            hint="Add one to let agents authenticate."
            action={
              <Button variant="solid" onClick={() => setCreating(true)}>
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
                <TH>Name</TH>
                <TH>Provider ref</TH>
                <TH>Purpose</TH>
                <TH>Status</TH>
                <TH className="w-0" />
              </tr>
            </THead>
            <tbody>
              {list.map((secret: SecretRefDto) => (
                <TR key={secret.id}>
                  <TD className="font-medium">{secret.name}</TD>
                  <TD className="machine text-xs text-ink-muted">{secret.providerRef}</TD>
                  <TD className="text-ink-muted">{secret.purpose}</TD>
                  <TD>
                    {secret.resolvable ? (
                      <StatusPill tone="live">resolved</StatusPill>
                    ) : (
                      <StatusPill tone="danger" dot>
                        missing
                      </StatusPill>
                    )}
                  </TD>
                  <TD>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${secret.name}`}
                      className="text-ink-faint hover:bg-danger-soft hover:text-danger"
                      onClick={() =>
                        confirm({
                          kind: "destroy",
                          title: `Delete “${secret.name}”?`,
                          body: (
                            <>
                              Any agent, repo, or MCP connection using this credential will stop
                              authenticating. This cannot be undone.
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
