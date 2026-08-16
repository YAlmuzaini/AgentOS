import {
  NETWORKING_MODES,
  type CreateEnvBindingInput,
  type CreateEnvironmentInput,
  type EnvironmentDto,
} from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Pencil, Plus, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { DeleteAction } from "../components/ui/delete-action";
import { CreatePanel } from "../components/ui/create-panel";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Field, Input, Select } from "../components/ui/form";
import { IconTile, toneFor } from "../components/ui/icon-tile";
import { Page, PageHeader } from "../components/ui/page";
import { Panel, PanelTitle } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { Table, TableCard, TD, TH, THead, TR } from "../components/ui/table";
import { useProjectGate } from "../hooks/use-project";
import { EditEnvironmentDialog } from "./edit-environment-dialog";
import { EnvVarsSection } from "./env-vars-section";
import { NoProject, ProjectPending } from "./project-states";

/**
 * There are two networking modes and only two: `limited` is an allowlist,
 * `open` is not. An earlier version also branched on a `none` mode that does
 * not exist in NETWORKING_MODES, so the safe case was never actually coloured.
 *
 * A mode is a category, and a category does not get a signal hue — `limited`
 * used to render emerald, which is the tone this system reserves for something
 * running right now, so a table of correctly configured environments read as a
 * column of live sessions. `open` keeps red, because it is the one value here
 * that genuinely breaks something: it takes the wall down.
 */
function networkTone(mode: string): "neutral" | "danger" {
  return mode === "open" ? "danger" : "neutral";
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
        // The pill is a fact, not an action, and the header's right-hand slot
        // is for the one action a screen is about — this screen's creates live
        // on their two sections.
        meta={
          unassigned > 0 ? (
            <StatusPill
              tone="gate"
              dot
              title="These variables reach no session until one is assigned."
            >
              {unassigned} unassigned
            </StatusPill>
          ) : undefined
        }
      />

      <section className="space-y-3">
        {/* A section heading, not a panel — this used to be a `Panel` with its
            border, fill and padding all switched off. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PanelTitle accent="emerald">Network policy</PanelTitle>
          {/* This screen's one solid button. An environment has to exist before
              a variable can be bound to one, so it is the primary of the two
              creates on the page. */}
          <Button variant="solid" onClick={() => setCreatingEnv(true)}>
            <Plus />
            New environment
          </Button>
        </div>

        <CreatePanel
          open={creatingEnv}
          onClose={() => setCreatingEnv(false)}
          title="New environment"
          description="Define the network access available to assigned agents."
          submitLabel="Create"
          pending={createEnvironment.isPending}
          disabled={!envName}
          // The drawer stays open on a refusal and covers the page behind it,
          // so this is the only place the operator can be told.
          error={createEnvironment.isError ? "Environment creation failed." : null}
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
            <Field label="Allowed hosts" hint="Enter comma-separated hostnames.">
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
              hint="Create an environment to define network access and make environment variables available to sessions."
              action={
                <Button variant="outline" onClick={() => setCreatingEnv(true)}>
                  <Plus />
                  New environment
                </Button>
              }
            />
          </Panel>
        ) : (
          <TableCard>
            <Table>
              <THead>
                <tr>
                  <TH>Environment</TH>
                  <TH>Networking</TH>
                  <TH>Allowed hosts</TH>
                  <TH className="w-0" />
                </tr>
              </THead>
              <tbody>
                {envList.map((environment: EnvironmentDto) => (
                  <TR key={environment.id}>
                    <TD className="max-w-[18rem]">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <IconTile tone={toneFor(environment.id)} size="sm">
                          <ShieldCheck />
                        </IconTile>
                        <p className="truncate font-medium text-ink">{environment.name}</p>
                      </div>
                    </TD>
                    <TD>
                      <StatusPill tone={networkTone(environment.networking)}>
                        {environment.networking}
                      </StatusPill>
                    </TD>
                    <TD className="max-w-[20rem]">
                      {environment.allowedHosts.length > 0 ? (
                        <span
                          className="machine block truncate text-xs text-ink-muted"
                          title={environment.allowedHosts.join(", ")}
                        >
                          {environment.allowedHosts.join(", ")}
                        </span>
                      ) : (
                        // An open policy has no list by design; a limited one
                        // with no list reaches nothing at all. Both were a bare
                        // em dash, which says neither.
                        <span className="flex items-center gap-1.5 text-xs text-ink-faint">
                          <Globe className="size-3.5 shrink-0" aria-hidden />
                          {environment.networking === "open" ? "any host" : "no host"}
                        </span>
                      )}
                    </TD>
                    <TD className="w-0">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          title={`Edit the network policy for ${environment.name}`}
                          onClick={() => setEditing(environment)}
                        >
                          <Pencil />
                          Edit
                        </Button>
                        <DeleteAction
                          what={environment.name}
                          body={
                            <>
                              Assigned agents will lose this network policy in new sessions. Its
                              environment variable bindings will also be deleted.
                            </>
                          }
                          onDelete={() => api.deleteEnvironment(project.id, environment.id)}
                          invalidate={[
                            ["environments", project.id],
                            ["env-bindings", project.id],
                            ["agents", project.id],
                          ]}
                        />
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
            error={updateEnvironment.isError ? "Unable to save the network policy." : null}
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
        error={createBinding.isError ? "Unable to create the environment variable binding." : null}
      />
    </Page>
  );
}
