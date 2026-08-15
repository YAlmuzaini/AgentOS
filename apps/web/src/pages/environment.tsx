import {
  NETWORKING_MODES,
  type CreateEnvBindingInput,
  type CreateEnvironmentInput,
  type EnvBindingDto,
  type EnvironmentDto,
} from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { CreatePanel } from "../components/ui/create-panel";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Field, Input, Select } from "../components/ui/form";
import { Page, PageHeader } from "../components/ui/page";
import { Panel, PanelHeader, PanelTitle } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { Table, TableCard, TD, TH, THead, TR } from "../components/ui/table";
import { useActiveProject } from "../hooks/use-project";
import { NoProject } from "./tasks";

/**
 * There are two modes and only two: `limited` is an allowlist, `open` is not.
 * An earlier version also branched on a `none` mode that does not exist in
 * NETWORKING_MODES, so the safe case was never actually coloured.
 */
function networkTone(mode: string): "live" | "danger" {
  return mode === "limited" ? "live" : "danger";
}

export function EnvironmentPage(): React.JSX.Element {
  const { project } = useActiveProject();
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

  const [envName, setEnvName] = useState("");
  const [networking, setNetworking] = useState<CreateEnvironmentInput["networking"]>("limited");
  const [envHosts, setEnvHosts] = useState("");

  const [environmentId, setEnvironmentId] = useState("");
  const [key, setKey] = useState("");
  const [secretId, setSecretId] = useState("");
  const [bindingHosts, setBindingHosts] = useState("");

  if (!project) {
    return <NoProject />;
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
          onSubmit={() => {
            createEnvironment.mutate({
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
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableCard>
        )}
      </section>

      <section className="space-y-3">
        <Panel className="flex items-center justify-between gap-3 border-0 bg-transparent p-0">
          <PanelTitle accent="violet">Environment variables</PanelTitle>
          <Button onClick={() => setCreatingBinding(true)}>
            <Plus />
            New variable
          </Button>
        </Panel>

        <CreatePanel
          open={creatingBinding}
          onClose={() => setCreatingBinding(false)}
          title="New environment variable"
          description="The environment is the grant — a variable without one reaches no session."
          submitLabel="Create"
          pending={createBinding.isPending}
          disabled={!key || !secretId || !environmentId}
          onSubmit={() => {
            createBinding.mutate({
              environmentId,
              key,
              secretId,
              allowedHosts: bindingHosts
                .split(",")
                .map((host) => host.trim())
                .filter(Boolean),
            });
            setKey("");
            setBindingHosts("");
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Deliberately not defaulted — see the description above. */}
            <Field label="Environment">
              {(id) => (
                <Select
                  id={id}
                  value={environmentId}
                  onChange={(event) => setEnvironmentId(event.target.value)}
                >
                  <option value="">select environment…</option>
                  {envList.map((environment) => (
                    <option key={environment.id} value={environment.id}>
                      {environment.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Key">
              {(id) => (
                <Input
                  id={id}
                  className="machine"
                  placeholder="KEY_NAME"
                  value={key}
                  onChange={(event) => setKey(event.target.value.toUpperCase())}
                />
              )}
            </Field>
            <Field label="Secret">
              {(id) => (
                <Select
                  id={id}
                  value={secretId}
                  onChange={(event) => setSecretId(event.target.value)}
                >
                  <option value="">select secret…</option>
                  {(secrets.data ?? []).map((secret) => (
                    <option key={secret.id} value={secret.id}>
                      {secret.name}
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
                  value={bindingHosts}
                  onChange={(event) => setBindingHosts(event.target.value)}
                />
              )}
            </Field>
          </div>
        </CreatePanel>

        {bindings.isLoading ? (
          <Panel>
            <SkeletonRows rows={2} />
          </Panel>
        ) : bindingList.length === 0 ? (
          <Panel>
            <EmptyState
              title="No environment variables yet"
              hint="Bind a secret to expose it to a session."
            />
          </Panel>
        ) : (
          <TableCard>
            <Table>
              <THead>
                <tr>
                  <TH>Key</TH>
                  <TH>Environment</TH>
                  <TH>Secret</TH>
                  <TH>Allowed hosts</TH>
                </tr>
              </THead>
              <tbody>
                {bindingList.map((binding: EnvBindingDto) => (
                  <TR key={binding.id}>
                    <TD className="machine text-xs font-medium">{binding.key}</TD>
                    <TD>
                      {binding.environmentId === null ? (
                        // Written before bindings were environment-scoped. It
                        // reaches no session until it is assigned one.
                        <StatusPill tone="gate" dot>
                          unassigned — never injected
                        </StatusPill>
                      ) : (
                        <span className="text-ink-muted">
                          {envList.find((e) => e.id === binding.environmentId)?.name ??
                            binding.environmentId}
                        </span>
                      )}
                    </TD>
                    <TD className="text-ink-muted">
                      {secrets.data?.find((s) => s.id === binding.secretId)?.name ??
                        binding.secretId}
                    </TD>
                    <TD className="machine text-xs text-ink-muted">
                      {binding.allowedHosts.join(", ") || "—"}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableCard>
        )}
      </section>
    </Page>
  );
}
