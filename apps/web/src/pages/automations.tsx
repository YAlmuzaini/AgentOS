import type { AgentDto, AutomationDto, TaskTemplateDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useActiveProject } from "../hooks/use-project";
import { CreateAutomationForm } from "./create-automation-form";

export function AutomationsPage(): React.JSX.Element {
  const { project } = useActiveProject();
  const queryClient = useQueryClient();
  const projectId = project?.id;

  const automations = useQuery({
    queryKey: ["automations", projectId],
    queryFn: () => api.automations(projectId!),
    enabled: Boolean(projectId),
  });

  const agents = useQuery({
    queryKey: ["agents", projectId],
    queryFn: () => api.agents(projectId!),
    enabled: Boolean(projectId),
  });

  const templates = useQuery({
    queryKey: ["templates", projectId],
    queryFn: () => api.templates(projectId!),
    enabled: Boolean(projectId),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["automations", projectId] });

  const create = useMutation({
    mutationFn: (body: Parameters<typeof api.createAutomation>[1]) =>
      api.createAutomation(projectId!, body),
    onSuccess: invalidate,
  });
  const enable = useMutation({
    mutationFn: (id: string) => api.enableAutomation(projectId!, id),
    onSuccess: invalidate,
  });
  const disable = useMutation({
    mutationFn: (id: string) => api.disableAutomation(projectId!, id),
    onSuccess: invalidate,
  });
  const run = useMutation({
    mutationFn: (id: string) => api.runAutomation(projectId!, id),
    onSuccess: invalidate,
  });

  if (!project) {
    return <p className="text-sm text-ink-muted">No project yet. Run `pnpm db:seed`.</p>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Automations</h1>

      <CreateAutomationForm
        agents={agents.data ?? []}
        templates={templates.data ?? []}
        onCreate={(body) => create.mutate(body)}
      />

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
            <tr>
              <th className="py-2">Name</th>
              <th>Cron</th>
              <th>Timezone</th>
              <th>Target</th>
              <th>Enabled</th>
              <th>Last fired</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(automations.data ?? []).map((automation) => (
              <AutomationRow
                key={automation.id}
                automation={automation}
                agents={agents.data ?? []}
                templates={templates.data ?? []}
                onEnable={() => enable.mutate(automation.id)}
                onDisable={() => disable.mutate(automation.id)}
                onRun={() => run.mutate(automation.id)}
              />
            ))}
          </tbody>
        </table>
        {automations.data?.length === 0 ? (
          <p className="py-2 text-sm text-ink-muted">No automations yet. Schedule one above.</p>
        ) : null}
      </div>
    </div>
  );
}

function AutomationRow(props: {
  automation: AutomationDto;
  agents: AgentDto[];
  templates: TaskTemplateDto[];
  onEnable: () => void;
  onDisable: () => void;
  onRun: () => void;
}): React.JSX.Element {
  const { automation } = props;
  const target = automation.taskTemplateId
    ? (props.templates.find((t) => t.id === automation.taskTemplateId)?.name ??
      automation.taskTemplateId)
    : (props.agents.find((a) => a.id === automation.agentId)?.name ?? automation.agentId);

  return (
    <tr className="border-t border-edge">
      <td className="py-2">{automation.name}</td>
      <td className="machine text-xs text-ink-muted">{automation.cron}</td>
      <td className="text-ink-muted">{automation.timezone}</td>
      <td className="text-ink-muted">{target}</td>
      <td>
        {automation.enabled ? (
          <span className="text-xs text-live">enabled</span>
        ) : (
          <span className="text-xs text-ink-faint">disabled</span>
        )}
      </td>
      <td className="machine text-xs text-ink-muted">
        {automation.lastFiredAt ? automation.lastFiredAt.slice(0, 19) : "never"}
      </td>
      <td className="space-x-1.5">
        <button
          className="rounded-sm bg-edge px-2 py-1 text-xs hover:bg-edge-strong"
          onClick={automation.enabled ? props.onDisable : props.onEnable}
        >
          {automation.enabled ? "Disable" : "Enable"}
        </button>
        <button
          className="rounded-sm bg-edge px-2 py-1 text-xs hover:bg-edge-strong"
          onClick={props.onRun}
        >
          Run now
        </button>
      </td>
    </tr>
  );
}
