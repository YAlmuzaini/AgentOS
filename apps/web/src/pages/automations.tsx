import type { AgentDto, AutomationDto, TaskTemplateDto } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, CalendarClock, FolderGit2, Globe, Pause, Play, Plus } from "lucide-react";
import { useState } from "react";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { DeleteAction } from "../components/ui/delete-action";
import { useConfirm } from "../components/ui/confirm";
import { EmptyState, InlineError, SkeletonRows } from "../components/ui/feedback";
import { IconTile, toneFor } from "../components/ui/icon-tile";
import { Meta, MetaRow } from "../components/ui/meta";
import { Page, PageHeader } from "../components/ui/page";
import { Panel } from "../components/ui/panel";
import { CountChip, StatusPill } from "../components/ui/pill";
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
        meta={list.length > 0 ? <CountChip>{list.length}</CountChip> : undefined}
        actions={
          <>
            {/* How many of them are armed — the only one of these facts that
                will spend money without the operator touching anything. */}
            {enabled > 0 ? (
              <StatusPill tone="live" dot>
                {enabled} scheduled
              </StatusPill>
            ) : null}
            <Button variant="solid" onClick={() => setCreating(true)}>
              <Plus />
              New automation
            </Button>
          </>
        }
      />

      {/* Arming, disarming and firing a schedule all used to fail in silence:
          the row simply did not change. */}
      {enable.isError || disable.isError ? (
        <InlineError>Unable to update the automation status.</InlineError>
      ) : null}
      {run.isError ? <InlineError>Unable to run the automation.</InlineError> : null}

      <CreateAutomationForm
        open={creating}
        onClose={() => setCreating(false)}
        pending={create.isPending}
        error={create.isError ? "Automation creation failed." : null}
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
            hint="Create an automation to schedule recurring tasks for an agent."
            action={
              <Button variant="outline" onClick={() => setCreating(true)}>
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
                <TH>Automation</TH>
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
                          <span className="machine">{automation.cron}</span> ({automation.timezone}
                          ). Each occurrence starts an agent session and consumes API credits.
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
                          This runs the automation outside its schedule, creates its task, and
                          starts an agent session that consumes API credits.
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
  const template = automation.taskTemplateId
    ? props.templates.find((t) => t.id === automation.taskTemplateId)
    : undefined;
  const agent = automation.taskTemplateId
    ? undefined
    : props.agents.find((a) => a.id === automation.agentId);
  const targetName = automation.taskTemplateId
    ? (template?.name ?? automation.taskTemplateId)
    : (agent?.name ?? automation.agentId);

  return (
    <TR>
      {/* The schedule is what an automation *is*, so the cron expression and
          its timezone ride under the name instead of holding two columns of
          their own. Both are machine values. */}
      <TD className="max-w-[22rem]">
        <div className="flex min-w-0 items-center gap-2.5">
          <IconTile tone={toneFor(automation.id)} size="sm">
            <CalendarClock />
          </IconTile>
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{automation.name}</p>
            <MetaRow>
              <Meta machine title={automation.cron}>
                {automation.cron}
              </Meta>
              <Meta icon={<Globe />} machine title={automation.timezone}>
                {automation.timezone}
              </Meta>
            </MetaRow>
          </div>
        </div>
      </TD>
      <TD className="max-w-[14rem]">
        <MetaRow>
          <Meta
            icon={automation.taskTemplateId ? <FolderGit2 /> : <Bot />}
            machine={automation.taskTemplateId ? !template : !agent}
            title={automation.taskTemplateId ? "Task template" : "Agent"}
          >
            {targetName}
          </Meta>
        </MetaRow>
      </TD>
      <TD>
        {automation.enabled ? (
          <StatusPill tone="live" dot>
            enabled
          </StatusPill>
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
      <TD className="w-0">
        <div className="flex items-center justify-end gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            title={
              automation.enabled
                ? `Disable the schedule for ${automation.name}`
                : `Arm the schedule for ${automation.name}`
            }
            onClick={automation.enabled ? props.onDisable : props.onEnable}
          >
            {automation.enabled ? <Pause /> : <Play />}
            {automation.enabled ? "Disable" : "Enable"}
          </Button>
          <DeleteAction
            what={automation.name}
            body={<>The schedule will be deleted. Existing tasks are not affected.</>}
            onDelete={props.onDeleted}
            invalidate={[["automations", props.projectId]]}
          />
          <Button
            size="sm"
            title={`Run ${automation.name} now, outside its schedule`}
            onClick={props.onRunConfirmed}
          >
            Run now
          </Button>
        </div>
      </TD>
    </TR>
  );
}
