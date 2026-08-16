import type {
  CreateEnvBindingInput,
  EnvBindingDto,
  EnvironmentDto,
  SecretRefDto,
} from "@agentos/shared";
import { Globe, KeyRound, Plus, Variable } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "../components/ui/button";
import { CreatePanel } from "../components/ui/create-panel";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Field, Input, Select } from "../components/ui/form";
import { IconTile, toneFor } from "../components/ui/icon-tile";
import { Meta, MetaRow } from "../components/ui/meta";
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
  /** The server's refusal. The drawer covers the page, so it has to show here. */
  error?: ReactNode;
}): React.JSX.Element {
  // The form's own state lives here now, with the form.
  const [environmentId, setEnvironmentId] = useState("");
  const [key, setKey] = useState("");
  const [secretId, setSecretId] = useState("");
  const [bindingHosts, setBindingHosts] = useState("");

  const { secrets, environments: envList, bindings: bindingList } = props;

  return (
    <section className="space-y-3">
      {/* A section heading, not a panel with its border and fill switched off,
          which is what this used to be. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PanelTitle accent="violet">Environment variables</PanelTitle>
        <Button variant="outline" onClick={() => props.onCreatingChange(true)}>
          <Plus />
          New variable
        </Button>
      </div>

      <CreatePanel
        open={props.creating}
        onClose={() => props.onCreatingChange(false)}
        title="New environment variable"
        description="Bind a secret to an environment variable for authorized sessions."
        submitLabel="Create"
        pending={props.pending}
        error={props.error}
        disabled={!key || !secretId || !environmentId}
        incomplete="A key, a secret and an environment are required."
        onSubmit={async () => {
          // Awaited: a rejected binding keeps the key and hosts as typed.
          await props.onCreate({
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
                <option value="">Select an environment</option>
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
                <option value="">Select a secret</option>
                {secrets.map((secret) => (
                  <option key={secret.id} value={secret.id}>
                    {secret.name}
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
                value={bindingHosts}
                onChange={(event) => setBindingHosts(event.target.value)}
              />
            )}
          </Field>
        </div>
      </CreatePanel>

      {props.loading ? (
        <Panel>
          <SkeletonRows rows={2} />
        </Panel>
      ) : bindingList.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Variable />}
            title="No environment variables yet"
            hint="Bind a secret to an environment variable for authorized sessions."
            action={
              <Button
                variant="outline"
                disabled={envList.length === 0}
                title={
                  envList.length === 0
                    ? "Create an environment before adding a variable."
                    : undefined
                }
                onClick={() => props.onCreatingChange(true)}
              >
                <Plus />
                New variable
              </Button>
            }
          />
        </Panel>
      ) : (
        <TableCard>
          <Table>
            <THead>
              <tr>
                <TH>Variable</TH>
                <TH>Environment</TH>
                <TH>Secret</TH>
                <TH>Allowed hosts</TH>
              </tr>
            </THead>
            <tbody>
              {bindingList.map((binding: EnvBindingDto) => {
                const environment = envList.find((e) => e.id === binding.environmentId);
                const secret = secrets.find((s) => s.id === binding.secretId);
                return (
                  <TR key={binding.id}>
                    <TD className="max-w-[18rem]">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <IconTile tone={toneFor(binding.id)} size="sm">
                          <Variable />
                        </IconTile>
                        <p className="machine truncate text-xs font-medium text-ink">
                          {binding.key}
                        </p>
                      </div>
                    </TD>
                    <TD className="max-w-[14rem]">
                      {binding.environmentId === null ? (
                        // Written before bindings were environment-scoped. It
                        // reaches no session until it is assigned one.
                        <StatusPill tone="gate" dot>
                          not assigned
                        </StatusPill>
                      ) : (
                        <span
                          className={`block truncate text-ink-muted ${
                            environment ? "" : "machine text-xs"
                          }`}
                        >
                          {environment?.name ?? binding.environmentId}
                        </span>
                      )}
                    </TD>
                    <TD className="max-w-[14rem]">
                      <MetaRow>
                        <Meta icon={<KeyRound />} machine={!secret} title={binding.secretId}>
                          {secret?.name ?? binding.secretId}
                        </Meta>
                      </MetaRow>
                    </TD>
                    <TD className="max-w-[18rem]">
                      {binding.allowedHosts.length > 0 ? (
                        <span
                          className="machine block truncate text-xs text-ink-muted"
                          title={binding.allowedHosts.join(", ")}
                        >
                          {binding.allowedHosts.join(", ")}
                        </span>
                      ) : (
                        // No restriction of its own: the variable travels
                        // wherever its environment's policy already allows.
                        <span className="flex items-center gap-1.5 text-xs text-ink-faint">
                          <Globe className="size-3.5 shrink-0" aria-hidden />
                          no restriction
                        </span>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        </TableCard>
      )}
    </section>
  );
}
