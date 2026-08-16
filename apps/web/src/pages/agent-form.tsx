import type { AgentDto, CreateAgentInput } from "@agentos/shared";
import { RUNNER_PREFERENCES } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, ApiError } from "../api";
import { CreatePanel } from "../components/ui/create-panel";
import { CheckboxField, Field, Input, Select, Textarea } from "../components/ui/form";
import { MicroLabel } from "../components/ui/panel";
import { FilesystemGrantField, IdListField, RepoAccessField } from "./agent-grant-fields";

/**
 * Creating and editing an agent (SPEC §18.1).
 *
 * `agentos.yml` remains the way to author a fleet and keep it in version
 * control. This is the other half: granting a repo, moving an agent onto the
 * local runner, or widening a folder are operational decisions made while
 * looking at the agent, and routing them through a file and a CLI meant the
 * screen that shows the grants could not change them.
 *
 * The name is absent on purpose — `updateAgentSchema` omits it, because other
 * agents refer to this one by name in their collaboration lists and the
 * prompts already name it.
 */
export function AgentForm(props: {
  projectId: string;
  /** Absent when creating. */
  agent?: AgentDto;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const editing = Boolean(props.agent);

  const [name, setName] = useState(props.agent?.name ?? "");
  const [title, setTitle] = useState(props.agent?.title ?? "");
  const [model, setModel] = useState(props.agent?.model ?? "claude-sonnet-5");
  const [rolePrompt, setRolePrompt] = useState(props.agent?.rolePrompt ?? "");
  const [environmentId, setEnvironmentId] = useState(props.agent?.environmentId ?? "");
  const [runnerPreference, setRunnerPreference] = useState<CreateAgentInput["runnerPreference"]>(
    props.agent?.runnerPreference ?? "inherit",
  );
  const [inboxAccess, setInboxAccess] = useState(props.agent?.inboxAccess ?? true);
  const [skillIds, setSkillIds] = useState<string[]>(props.agent?.skillIds ?? []);
  const [mcpConnectionIds, setMcpIds] = useState<string[]>(props.agent?.mcpConnectionIds ?? []);
  const [repoAccess, setRepoAccess] = useState(props.agent?.repoAccess ?? []);
  const [filesystemGrants, setGrants] = useState(props.agent?.filesystemGrants ?? []);
  const [collaborationList, setCollaboration] = useState<string[]>(
    props.agent?.collaborationList ?? [],
  );

  const repos = useQuery({
    queryKey: ["repos", props.projectId],
    queryFn: () => api.repos(props.projectId),
    enabled: props.open,
  });
  const skills = useQuery({
    queryKey: ["skills", props.projectId],
    queryFn: () => api.skills(props.projectId),
    enabled: props.open,
  });
  const mcps = useQuery({
    queryKey: ["mcp-connections", props.projectId],
    queryFn: () => api.mcpConnections(props.projectId),
    enabled: props.open,
  });
  const environments = useQuery({
    queryKey: ["environments", props.projectId],
    queryFn: () => api.environments(props.projectId),
    enabled: props.open,
  });
  const agents = useQuery({
    queryKey: ["agents", props.projectId],
    queryFn: () => api.agents(props.projectId),
    enabled: props.open,
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title,
        model,
        rolePrompt,
        skillIds,
        mcpConnectionIds,
        repoAccess,
        filesystemGrants,
        collaborationList,
        environmentId: environmentId || null,
        runnerPreference,
        inboxAccess,
      };
      return props.agent
        ? api.updateAgent(props.projectId, props.agent.id, body)
        : api.createAgent(props.projectId, { ...body, name });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["agents", props.projectId] });
      if (props.agent) {
        void queryClient.invalidateQueries({
          queryKey: ["agent", props.projectId, props.agent.id],
        });
      }
      props.onClose();
    },
  });

  return (
    <CreatePanel
      open={props.open}
      onClose={props.onClose}
      title={editing ? `Edit ${props.agent?.name}` : "New agent"}
      description={
        editing
          ? "Everything a session is allowed to reach. An absent grant is an absent capability."
          : "A slug, a role, and what it may reach. Nothing is granted by default."
      }
      submitLabel={editing ? "Save" : "Create agent"}
      pending={save.isPending}
      disabled={!title || !rolePrompt || (!editing && !name)}
      error={save.isError ? (save.error instanceof ApiError ? save.error.message : "could not save") : null}
      onSubmit={() => save.mutateAsync().then(() => undefined)}
    >
      {!editing ? (
        <Field label="Name" hint="Lowercase slug. Other agents refer to this one by it, permanently.">
          {(id) => (
            <Input
              id={id}
              className="machine"
              value={name}
              placeholder="release-notes"
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
      ) : null}

      <Field label="Title">
        {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Model">
          {(id) => <Input id={id} className="machine" value={model} onChange={(e) => setModel(e.target.value)} />}
        </Field>
        <Field label="Runs on" hint="`inherit` follows the project setting.">
          {(id) => (
            <Select
              id={id}
              value={runnerPreference}
              onChange={(e) =>
                setRunnerPreference(e.target.value as CreateAgentInput["runnerPreference"])
              }
            >
              {RUNNER_PREFERENCES.map((preference) => (
                <option key={preference} value={preference}>
                  {preference}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <Field
        label="Network environment"
        hint="Decides which hosts a session may reach. None means deny everything."
      >
        {(id) => (
          <Select id={id} value={environmentId} onChange={(e) => setEnvironmentId(e.target.value)}>
            <option value="">none — no egress</option>
            {(environments.data ?? []).map((environment) => (
              <option key={environment.id} value={environment.id}>
                {environment.name} ({environment.networking})
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field label="Role prompt" hint="The one job this agent has.">
        {(id) => (
          <Textarea id={id} rows={8} value={rolePrompt} onChange={(e) => setRolePrompt(e.target.value)} />
        )}
      </Field>

      <div className="space-y-2">
        <MicroLabel>Repositories</MicroLabel>
        <RepoAccessField value={repoAccess} repos={repos.data ?? []} onChange={setRepoAccess} />
      </div>

      <div className="space-y-2">
        <MicroLabel>Filesystem</MicroLabel>
        <FilesystemGrantField value={filesystemGrants} onChange={setGrants} />
      </div>

      <IdListField
        label="MCP servers"
        options={(mcps.data ?? []).map((mcp) => ({ id: mcp.id, label: mcp.name }))}
        value={mcpConnectionIds}
        onChange={setMcpIds}
      />

      <IdListField
        label="Skills"
        options={(skills.data ?? []).map((skill) => ({ id: skill.id, label: skill.name }))}
        value={skillIds}
        onChange={setSkillIds}
      />

      <IdListField
        label="May spawn"
        options={(agents.data ?? [])
          .filter((candidate) => candidate.id !== props.agent?.id)
          .map((candidate) => ({ id: candidate.name, label: candidate.name }))}
        value={collaborationList}
        onChange={setCollaboration}
      />

      <CheckboxField
        label="May ask you questions through the inbox"
        checked={inboxAccess}
        onCheckedChange={setInboxAccess}
      />
    </CreatePanel>
  );
}
