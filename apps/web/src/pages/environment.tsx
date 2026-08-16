import {
  NETWORKING_MODES,
  type CreateEnvBindingInput,
  type CreateEnvironmentInput,
  type EnvBindingDto,
  type EnvironmentDto,
} from "@agentos/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { CreatePanel } from "../components/ui/create-panel";
import { EmptyState, InlineError, SkeletonRows } from "../components/ui/feedback";
import { Field, FormActions, Input, Select } from "../components/ui/form";
import { Page, PageHeader } from "../components/ui/page";
import { Panel, PanelHeader, PanelTitle } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { Table, TableCard, TD, TH, THead, TR } from "../components/ui/table";
import { useProjectGate } from "../hooks/use-project";
import { EditEnvironmentDialog } from "./edit-environment-dialog";
import { EnvVarsSection } from "./env-vars-section";
import { NoProject, ProjectPending } from "./project-states";

/**
 * Editing an existing environment. The API has had PUT since the beginning and
 * nothing called it, so a network policy could be created and then never
 * corrected — which matters more here than on any other resource, because this
 * is the wall that decides which hosts a session can reach.
 */
function networkTone(mode: string): "live" | "danger" {
  return mode === "limited" ? "live" : "danger";
}

export function EnvironmentPage(): React.JSX.Element {
  const { project, pending, absent } = useProjectGate();
  const queryClient = useQueryClient();
  const projectId = project?.id;
  const [creatingEnv, setCreatingEnv] = useState(false);
  const [creatingBinding, setCreatingBinding] = useState(false);

  const environments = useQuery({
    queryKey: ["environments", projectId],
    queryFn: () => api.environments(projectId!),
    enabled: Boolean(projectId),
  });

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

  const createEnvironment = useMutation({
    mutationFn: (body: CreateEnvironmentInput) => api.createEnvironment(projectId!, body),
    onSuccess: () => {
      setCreatingEnv(false);
      void queryClient.invalidateQueries({ queryKey: ["environments", projectId] });
    },
  });

  const createBinding = useMutation({
    mutationFn: (body: CreateEnvBindingInput) => api.createEnvBinding(projectId!, body),
    onSuccess: () => {
      setCreatingBinding(false);
      void queryClient.invalidateQueries({ queryKey: ["env-bindings", projectId] });
    },
  });

  const [editing, setEditing] = useState<EnvironmentDto | null>(null);

  const updateEnvironment = useMutation({
    mutationFn: (input: { id: string; body: CreateEnvironmentInput }) =>
      api.updateEnvironment(projectId!, input.id, input.body),
    onSuccess: () => {
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ["environments", projectId] });
    },
  });

  const [envName, setEnvName] = useState("");
  const [networking, setNetworking] = useState<CreateEnvironmentInput["networking"]>("limited");
  const [envHosts, setEnvHosts] = useState("");


  if (absent) {
    return <NoProject />;
  }
  if (pending || !project) {
    return <ProjectPending />;
  }

  const envList = environments.data ?? [];
  const bindingList = bindings.data ?? [];
  const unassigned = bindingList.filter((binding) => binding.environmentId === null).length;

  return (
    <Page>
      <PageHeader
        icon={<ShieldCheck />}
        title="Environment"
        actions={
          unassigned > 0 ? (
            <StatusPill tone="gate" dot>
              {unassigned} unassigned
            </StatusPill>
          ) : null
        }
      />

      <section className="space-y-3">
        <Panel className="flex items-center justify-between gap-3 border-0 bg-transparent p-0">
          <PanelTitle accent="emerald">Network policy</PanelTitle>
          <Button onClick={() => setCreatingEnv(true)}>
            <Plus />
            New environment
          </Button>
        </Panel>

        <CreatePanel
          open={creatingEnv}
          onClose={() => setCreatingEnv(false)}
          title="New environment"
          description="A session reaches only the hosts listed here."
          submitLabel="Create"
          pending={createEnvironment.isPending}
          disabled={!envName}
          onSubmit={async () => {
            await createEnvironment.mutateAsync({
              name: envName,
              networking,
              allowedHosts: envHosts
                .split(",")
                .map((host) => host.trim())
                .filter(Boolean),
            });
            setEnvName("");
            setEnvHosts("");
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name">
              {(id) => (
                <Input
                  id={id}
                  value={envName}
                  onChange={(event) => setEnvName(event.target.value)}
                />
              )}
            </Field>
            <Field label="Networking">
              {(id) => (
                <Select
                  id={id}
                  value={networking}
                  onChange={(event) =>
                    setNetworking(event.target.value as CreateEnvironmentInput["networking"])
                  }
                >
                  {NETWORKING_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {mode}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Allowed hosts" hint="Comma separated.">
              {(id) => (
                <Input
                  id={id}
                  className="machine"
                  value={envHosts}
                  onChange={(event) => setEnvHosts(event.target.value)}
                />
              )}
            </Field>
          </div>
        </CreatePanel>

        {environments.isLoading ? (
          <Panel>
            <SkeletonRows rows={2} />
          </Panel>
        ) : envList.length === 0 ? (
          <Panel>
            <EmptyState
              icon={<ShieldCheck />}
              title="No environments yet"
              hint="Create one to set a network policy."
            />
          </Panel>
        ) : (
          <TableCard>
            <Table>
              <THead>
                <tr>
                  <TH>Name</TH>
                  <TH>Networking</TH>
                  <TH>Allowed hosts</TH>
                  <TH className="w-0" />
                </tr>
              </THead>
              <tbody>
                {envList.map((environment: EnvironmentDto) => (
                  <TR key={environment.id}>
                    <TD className="font-medium">{environment.name}</TD>
                    <TD>
                      <StatusPill tone={networkTone(environment.networking)}>
                        {environment.networking}
                      </StatusPill>
                    </TD>
                    <TD className="machine text-xs text-ink-muted">
                      {environment.allowedHosts.join(", ") || "—"}
                    </TD>
                    <TD>
                      <div className="flex justify-end">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(environment)}>
                          <Pencil />
                          Edit
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableCard>
        )}
        {editing ? (
          <EditEnvironmentDialog
            environment={editing}
            pending={updateEnvironment.isPending}
            onClose={() => setEditing(null)}
            onSave={(body) => updateEnvironment.mutate({ id: editing.id, body })}
          />
        ) : null}
      </section>

      <EnvVarsSection
        secrets={secrets.data ?? []}
        environments={envList}
        bindings={bindingList}
        creating={creatingBinding}
        loading={bindings.isLoading}
        onCreatingChange={setCreatingBinding}
        onCreate={(body) => createBinding.mutateAsync(body).then(() => undefined)}
        pending={createBinding.isPending}
      />

    </Page>
  );
}
