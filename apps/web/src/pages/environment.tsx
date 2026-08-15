import {
  NETWORKING_MODES,
  type CreateEnvBindingInput,
  type CreateEnvironmentInput,
  type EnvBindingDto,
  type EnvironmentDto,
} from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { useActiveProject } from "../hooks/use-project";

export function EnvironmentPage(): React.JSX.Element {
  const { project } = useActiveProject();
  const queryClient = useQueryClient();
  const projectId = project?.id;

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["environments", projectId] }),
  });

  const createBinding = useMutation({
    mutationFn: (body: CreateEnvBindingInput) => api.createEnvBinding(projectId!, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["env-bindings", projectId] }),
  });

  if (!project) {
    return <p className="text-sm text-ink-muted">No project yet. Run `pnpm db:seed`.</p>;
  }

  return (
    <div className="space-y-8">
      <h1 className="text-lg font-semibold">Environment</h1>

      <section className="space-y-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
          Network policy
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
              <tr>
                <th className="py-2">Name</th>
                <th>Networking</th>
                <th>Allowed hosts</th>
              </tr>
            </thead>
            <tbody>
              {(environments.data ?? []).map((environment: EnvironmentDto) => (
                <tr key={environment.id} className="border-t border-edge">
                  <td className="py-2">{environment.name}</td>
                  <td className="text-ink-muted">{environment.networking}</td>
                  <td className="text-xs text-ink-muted">
                    {environment.allowedHosts.join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {environments.data?.length === 0 ? (
            <p className="py-2 text-sm text-ink-muted">
              No environments yet. Create one to set a network policy.
            </p>
          ) : null}
        </div>
        <CreateEnvironmentForm onCreate={(body) => createEnvironment.mutate(body)} />
      </section>

      <section className="space-y-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
          Environment variables
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
              <tr>
                <th className="py-2">Key</th>
                <th>Environment</th>
                <th>Secret</th>
                <th>Allowed hosts</th>
              </tr>
            </thead>
            <tbody>
              {(bindings.data ?? []).map((binding: EnvBindingDto) => (
                <tr key={binding.id} className="border-t border-edge">
                  <td className="py-2 machine text-xs">{binding.key}</td>
                  <td className="text-ink-muted">
                    {binding.environmentId === null ? (
                      // Written before bindings were environment-scoped. It
                      // reaches no session until it is assigned one.
                      <span className="text-gate">unassigned — never injected</span>
                    ) : (
                      (environments.data?.find((e) => e.id === binding.environmentId)?.name ??
                        binding.environmentId)
                    )}
                  </td>
                  <td className="text-ink-muted">
                    {secrets.data?.find((s) => s.id === binding.secretId)?.name ?? binding.secretId}
                  </td>
                  <td className="text-xs text-ink-muted">
                    {binding.allowedHosts.join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {bindings.data?.length === 0 ? (
            <p className="py-2 text-sm text-ink-muted">
              No environment variables yet. Bind a secret to expose it.
            </p>
          ) : null}
        </div>
        <CreateEnvBindingForm
          environments={environments.data ?? []}
          secrets={secrets.data ?? []}
          onCreate={(body) => createBinding.mutate(body)}
        />
      </section>
    </div>
  );
}

function CreateEnvironmentForm(props: {
  onCreate: (body: CreateEnvironmentInput) => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [networking, setNetworking] = useState<CreateEnvironmentInput["networking"]>("limited");
  const [allowedHosts, setAllowedHosts] = useState("");

  return (
    <form
      className="grid gap-2 rounded-md border border-edge bg-surface-raised p-3 md:grid-cols-[1fr_auto_1fr_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name) return;
        props.onCreate({
          name,
          networking,
          allowedHosts: allowedHosts
            .split(",")
            .map((host) => host.trim())
            .filter(Boolean),
        });
        setName("");
        setAllowedHosts("");
      }}
    >
      <input
        className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
        placeholder="Environment name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <select
        className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
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
      </select>
      <input
        className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
        placeholder="allowed hosts (comma separated)"
        value={allowedHosts}
        onChange={(event) => setAllowedHosts(event.target.value)}
      />
      <button className="rounded-sm bg-edge px-3 py-1.5 text-sm hover:bg-edge-strong" type="submit">
        Create
      </button>
    </form>
  );
}

function CreateEnvBindingForm(props: {
  environments: Array<{ id: string; name: string }>;
  secrets: Array<{ id: string; name: string }>;
  onCreate: (body: CreateEnvBindingInput) => void;
}): React.JSX.Element {
  const [environmentId, setEnvironmentId] = useState("");
  const [key, setKey] = useState("");
  const [secretId, setSecretId] = useState("");
  const [allowedHosts, setAllowedHosts] = useState("");

  return (
    <form
      className="grid gap-2 rounded-md border border-edge bg-surface-raised p-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        if (!key || !secretId || !environmentId) return;
        props.onCreate({
          environmentId,
          key,
          secretId,
          allowedHosts: allowedHosts
            .split(",")
            .map((host) => host.trim())
            .filter(Boolean),
        });
        setKey("");
        setAllowedHosts("");
      }}
    >
      {/* The environment is the grant. A variable with no environment reaches
          no session, so this is deliberately not defaulted. */}
      <select
        className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
        value={environmentId}
        onChange={(event) => setEnvironmentId(event.target.value)}
      >
        <option value="">select environment…</option>
        {props.environments.map((environment) => (
          <option key={environment.id} value={environment.id}>
            {environment.name}
          </option>
        ))}
      </select>
      <input
        className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm machine"
        placeholder="KEY_NAME"
        value={key}
        onChange={(event) => setKey(event.target.value.toUpperCase())}
      />
      <select
        className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
        value={secretId}
        onChange={(event) => setSecretId(event.target.value)}
      >
        <option value="">select secret…</option>
        {props.secrets.map((secret) => (
          <option key={secret.id} value={secret.id}>
            {secret.name}
          </option>
        ))}
      </select>
      <input
        className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
        placeholder="allowed hosts (comma separated)"
        value={allowedHosts}
        onChange={(event) => setAllowedHosts(event.target.value)}
      />
      <button className="rounded-sm bg-edge px-3 py-1.5 text-sm hover:bg-edge-strong" type="submit">
        Create
      </button>
    </form>
  );
}
