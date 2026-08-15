import type { AgentDto, TriggerFireDto, TriggerSecretDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import { useActiveProject } from "../hooks/use-project";

export function TriggersPage(): React.JSX.Element {
  const { project } = useActiveProject();
  const queryClient = useQueryClient();
  const projectId = project?.id;
  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<TriggerSecretDto | null>(null);

  const triggers = useQuery({
    queryKey: ["triggers", projectId],
    queryFn: () => api.triggers(projectId!),
    enabled: Boolean(projectId),
  });

  const agents = useQuery({
    queryKey: ["agents", projectId],
    queryFn: () => api.agents(projectId!),
    enabled: Boolean(projectId),
  });

  const create = useMutation({
    mutationFn: (body: Parameters<typeof api.createTrigger>[1]) =>
      api.createTrigger(projectId!, body),
    onSuccess: (trigger) => {
      void queryClient.invalidateQueries({ queryKey: ["triggers", projectId] });
      setRevealed(trigger);
    },
  });

  const rotate = useMutation({
    mutationFn: (id: string) => api.rotateTriggerSecret(projectId!, id),
    onSuccess: (trigger) => {
      void queryClient.invalidateQueries({ queryKey: ["triggers", projectId] });
      setRevealed(trigger);
    },
  });

  const fires = useQuery({
    queryKey: ["trigger-fires", projectId, selected],
    queryFn: () => api.triggerFires(projectId!, selected!),
    enabled: Boolean(projectId && selected),
    refetchInterval: 5000,
  });

  if (!project) {
    return <p className="text-sm text-ink-muted">No project yet. Run `pnpm db:seed`.</p>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Triggers</h1>

      {revealed ? (
        <SigningKeyPanel trigger={revealed} onDismiss={() => setRevealed(null)} />
      ) : null}

      <CreateTriggerForm
        agents={agents.data ?? []}
        onCreate={(body) => create.mutate(body)}
      />

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
            <tr>
              <th className="py-2">Name</th>
              <th>Agent</th>
              <th>URL</th>
              <th>Enabled</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(triggers.data ?? []).map((trigger) => (
              <tr
                key={trigger.id}
                className={`cursor-pointer border-t border-edge ${
                  selected === trigger.id ? "bg-edge" : ""
                }`}
                onClick={() => setSelected(trigger.id)}
              >
                <td className="py-2">{trigger.name}</td>
                <td className="text-ink-muted">
                  {agents.data?.find((a) => a.id === trigger.agentId)?.name ?? trigger.agentId}
                </td>
                <td className="machine text-xs text-ink-muted">{trigger.url}</td>
                <td>
                  {trigger.enabled ? (
                    <span className="text-xs text-live">enabled</span>
                  ) : (
                    <span className="text-xs text-ink-faint">disabled</span>
                  )}
                </td>
                <td>
                  <button
                    className="rounded-sm bg-edge px-2 py-1 text-xs hover:bg-edge-strong"
                    onClick={(event) => {
                      event.stopPropagation();
                      rotate.mutate(trigger.id);
                    }}
                  >
                    Rotate secret
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {triggers.data?.length === 0 ? (
          <p className="py-2 text-sm text-ink-muted">
            No triggers. Create one to receive webhooks.
          </p>
        ) : null}
      </div>

      {selected ? (
        <section>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
            Recent fires
          </h2>
          <ul className="space-y-1 font-mono text-xs">
            {(fires.data ?? []).map((fire) => (
              <FireRow key={fire.id} fire={fire} />
            ))}
          </ul>
          {fires.data?.length === 0 ? <p className="text-sm text-ink-muted">No fires yet.</p> : null}
        </section>
      ) : null}
    </div>
  );
}

function FireRow(props: { fire: TriggerFireDto }): React.JSX.Element {
  const { fire } = props;
  return (
    <li className="rounded-sm bg-surface-sunken px-2 py-1">
      <span className="text-ink-faint">{fire.createdAt.slice(0, 19)}</span>{" "}
      {fire.accepted ? (
        <span className="text-live">accepted</span>
      ) : (
        <span className="text-danger">rejected{fire.reason ? `: ${fire.reason}` : ""}</span>
      )}
    </li>
  );
}

function SigningKeyPanel(props: {
  trigger: TriggerSecretDto;
  onDismiss: () => void;
}): React.JSX.Element {
  return (
    <div className="space-y-2 rounded-md border border-edge bg-surface-raised p-3">
      <p className="text-sm font-medium text-gate">
        Signing key for {props.trigger.name} — shown once, never again
      </p>
      <code className="block break-all rounded-sm bg-surface-sunken p-2 text-xs">
        {props.trigger.signingKey}
      </code>
      <button
        className="rounded-sm bg-edge px-3 py-1.5 text-xs hover:bg-edge-strong"
        onClick={props.onDismiss}
      >
        I've saved it, dismiss
      </button>
    </div>
  );
}

function CreateTriggerForm(props: {
  agents: AgentDto[];
  onCreate: (body: { name: string; agentId: string; jobPrompt: string; enabled: boolean }) => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState("");
  const [jobPrompt, setJobPrompt] = useState("");

  return (
    <form
      className="space-y-2 rounded-md border border-edge bg-surface-raised p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name || !agentId) return;
        props.onCreate({ name, agentId, jobPrompt, enabled: true });
        setName("");
        setJobPrompt("");
      }}
    >
      <div className="grid gap-2 md:grid-cols-2">
        <input
          className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
          placeholder="name (kebab-case)"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <select
          className="rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
          value={agentId}
          onChange={(event) => setAgentId(event.target.value)}
        >
          <option value="">assign agent…</option>
          {props.agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </div>
      <textarea
        className="w-full rounded-sm border border-edge bg-surface-sunken px-2 py-1.5 text-sm"
        placeholder="Job prompt — what the agent should do with an inbound event"
        rows={3}
        value={jobPrompt}
        onChange={(event) => setJobPrompt(event.target.value)}
      />
      <button className="rounded-sm bg-edge px-3 py-1.5 text-sm hover:bg-edge-strong" type="submit">
        Create
      </button>
    </form>
  );
}
