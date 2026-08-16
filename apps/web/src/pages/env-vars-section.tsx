import type { CreateEnvBindingInput, EnvBindingDto, EnvironmentDto, SecretRefDto } from "@agentos/shared";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { CreatePanel } from "../components/ui/create-panel";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Field, Input, Select } from "../components/ui/form";
import { Panel, PanelTitle } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { Table, TableCard, TD, TH, THead, TR } from "../components/ui/table";

/**
 * The variables an environment injects, and the secrets behind them.
 *
 * Its own file because it is a second screen sharing a page: the policy above
 * decides where a session may reach, this decides what it carries when it gets
 * there. They are related but not the same concern.
 */
export function EnvVarsSection(props: {
  secrets: SecretRefDto[];
  environments: EnvironmentDto[];
  bindings: EnvBindingDto[];
  creating: boolean;
  /** From the parent's query — a slow load must not read as "none exist". */
  loading: boolean;
  onCreatingChange: (open: boolean) => void;
  onCreate: (body: CreateEnvBindingInput) => void | Promise<void>;
  pending: boolean;
}): React.JSX.Element {
  // The form's own state lives here now, with the form.
  const [environmentId, setEnvironmentId] = useState("");
  const [key, setKey] = useState("");
  const [secretId, setSecretId] = useState("");
  const [bindingHosts, setBindingHosts] = useState("");

  const secrets = { data: props.secrets };
  const envList = props.environments;
  const bindingList = props.bindings;
  // The page owns the fetch; this only renders what it was handed.
  const bindings = { isLoading: props.loading };
  const creatingBinding = props.creating;
  const setCreatingBinding = props.onCreatingChange;
  const createBinding = { isPending: props.pending, mutate: props.onCreate };

  return (
    <>
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
          onSubmit={async () => {
            // Awaited: a rejected binding keeps the key and hosts as typed.
            await createBinding.mutate({
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
    </>
  );
}
