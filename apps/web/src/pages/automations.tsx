import type { AgentDto, AutomationDto, TaskTemplateDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Pause, Play, Plus } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { DeleteAction } from "../components/ui/delete-action";
import { useConfirm } from "../components/ui/confirm";
import { EmptyState, SkeletonRows } from "../components/ui/feedback";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { StatusPill } from "../components/ui/pill";
import { Table, TableCard, TD, TH, THead, TR } from "../components/ui/table";
import { useProjectGate } from "../hooks/use-project";
import { relativeTime } from "../lib/time";
import { CreateAutomationForm } from "./create-automation-form";
import { NoProject, ProjectPending } from "./project-states";

export function AutomationsPage(): React.JSX.Element {
  const { project, pending, absent } = useProjectGate();
  const queryClient = useQueryClient();
  const projectId = project?.id;
  const [creating, setCreating] = useState(false);
  const confirm = useConfirm();

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
    onSuccess: () => {
      setCreating(false);
      void invalidate();
    },
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

  if (absent) {
    return <NoProject />;
  }
  if (pending || !project) {
    return <ProjectPending />;
  }

  const list = automations.data ?? [];
  const enabled = list.filter((automation) => automation.enabled).length;

  return (
    <Page>
      <PageHeader
        icon={<CalendarClock />}
        title="Automations"
        actions={
          <>
            {enabled > 0 ? <StatusPill tone="live" dot>{enabled} scheduled</StatusPill> : null}
            <Button variant="solid" onClick={() => setCreating(true)}>
              <Plus />
              New automation
            </Button>
          </>
        }
      />

      <CreateAutomationForm
        open={creating}
        onClose={() => setCreating(false)}
        pending={create.isPending}
        agents={agents.data ?? []}
        templates={templates.data ?? []}
        // `mutateAsync` so the form can wait, and so a rejection reaches it —
        // that is what stops the panel clearing input the server refused.
        onCreate={(body) => create.mutateAsync(body).then(() => undefined)}
      />

      {automations.isLoading ? (
        <Panel>
          <SkeletonRows />
        </Panel>
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<CalendarClock />}
            title="No automations yet"
            hint="Create a recurring task schedule."
            action={
              <Button variant="solid" onClick={() => setCreating(true)}>
                <Plus />
                New automation
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
                <TH>Cron</TH>
                <TH>Timezone</TH>
                <TH>Target</TH>
                <TH>State</TH>
                <TH>Last fired</TH>
                <TH className="w-0" />
              </tr>
            </THead>
            <tbody>
              {list.map((automation) => (
                <AutomationRow
                  key={automation.id}
                  automation={automation}
                  agents={agents.data ?? []}
                  templates={templates.data ?? []}
                  onEnable={() =>
                    confirm({
                      kind: "spend",
                      title: `Enable “${automation.name}”?`,
                      body: (
                        <>
                          This enables the schedule{" "}
                          <span className="machine">{automation.cron}</span> ({automation.timezone}).
                          Each occurrence starts an agent session and consumes API credits.
                        </>
                      ),
                      confirmLabel: "Enable",
                      onConfirm: () => enable.mutate(automation.id),
                    })
                  }
                  onDisable={() => disable.mutate(automation.id)}
                  projectId={project.id}
                  onDeleted={() => api.deleteAutomation(project.id, automation.id)}
                  onRunConfirmed={() =>
                    confirm({
                      kind: "spend",
                      title: `Run “${automation.name}” now?`,
                      body: (
                        <>
                          This runs the automation outside its schedule, creates its task, and starts
                          an agent session that consumes API credits.
                        </>
                      ),
                      confirmLabel: "Run now",
                      onConfirm: () => run.mutate(automation.id),
                    })
                  }
                />
              ))}
            </tbody>
          </Table>
        </TableCard>
      )}
    </Page>
  );
}

function AutomationRow(props: {
  automation: AutomationDto;
  agents: AgentDto[];
  templates: TaskTemplateDto[];
  onEnable: () => void;
  onDisable: () => void;
  onRunConfirmed: () => void;
  onDeleted: () => Promise<unknown>;
  projectId: string;
}): React.JSX.Element {
  const { automation } = props;
  const target = automation.taskTemplateId
    ? (props.templates.find((t) => t.id === automation.taskTemplateId)?.name ??
      automation.taskTemplateId)
    : (props.agents.find((a) => a.id === automation.agentId)?.name ?? automation.agentId);

  return (
    <TR>
      <TD className="font-medium">{automation.name}</TD>
      <TD className="machine text-xs text-ink-muted">{automation.cron}</TD>
      <TD className="text-ink-muted">{automation.timezone}</TD>
      <TD className="text-ink-muted">{target}</TD>
      <TD>
        {automation.enabled ? (
          <StatusPill tone="live">enabled</StatusPill>
        ) : (
          <StatusPill tone="neutral">disabled</StatusPill>
        )}
      </TD>
      <TD className="text-ink-muted">
        {automation.lastFiredAt ? (
          <span title={automation.lastFiredAt}>{relativeTime(automation.lastFiredAt)}</span>
        ) : (
          <span className="text-ink-faint">never</span>
        )}
      </TD>
      <TD>
        <div className="flex justify-end gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={automation.enabled ? props.onDisable : props.onEnable}
          >
            {automation.enabled ? <Pause /> : <Play />}
            {automation.enabled ? "Disable" : "Enable"}
          </Button>
          <DeleteAction
            what={automation.name}
            body={
              <>
                The schedule will be deleted. Existing tasks are not affected.
              </>
            }
            onDelete={props.onDeleted}
            invalidate={[["automations", props.projectId]]}
          />
          <Button size="sm" onClick={props.onRunConfirmed}>
            Run now
          </Button>
        </div>
      </TD>
    </TR>
  );
}
