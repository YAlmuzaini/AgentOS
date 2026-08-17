import type { AgentDto, Category, CreateAgentInput } from "@agentos/shared";
import { CATEGORIES, CATEGORY_LABELS, RUNNER_PREFERENCES } from "@agentos/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Blocks, FolderTree, GitBranch, Server } from "lucide-react";
import type { ReactNode } from "react";
import { useId, useState } from "react";
import { api, ApiError } from "../api";
import { CreatePanel } from "../components/ui/create-panel";
import { CheckboxField, Field, Input, Select, Textarea } from "../components/ui/form";
import { IconTile } from "../components/ui/icon-tile";
import { MicroLabel } from "../components/ui/panel";
import { DenyNote, FilesystemGrantField, IdListField, RepoAccessField } from "./agent-grant-fields";

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
 *
 * It is the longest form in the product, and it used to be one undifferentiated
 * column of fourteen controls: the four walls PRODUCT.md calls non-negotiable —
 * MCP grant, network allowlist, filesystem ACL, repo access — sat between a
 * model box and a checkbox list of skills with nothing to say they were the
 * security boundary. They now read as four deliberate sections under one
 * heading that states the rule they enforce.
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
  const [description, setDescription] = useState(props.agent?.description ?? "");
  const [category, setCategory] = useState<Category>(props.agent?.category ?? "general");
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
  // Which of the three required fields the operator has already been in. A
  // drawer that opens with everything already red is scolding them for not
  // having typed yet; a submit that is dead with no reason given is worse.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (field: string): void => setTouched((prior) => ({ ...prior, [field]: true }));
  // The network wall holds one control, so its heading is that control's label.
  const environmentFieldId = useId();

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
        description,
        category,
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

  const nameError =
    touched.name && !editing && name.trim().length === 0
      ? "Agent name is required."
      : null;
  const titleError = touched.title && title.trim().length === 0 ? "Agent title is required." : null;
  const rolePromptError =
    touched.rolePrompt && rolePrompt.trim().length === 0
      ? "Role prompt is required."
      : null;

  const environment = environments.data?.find((candidate) => candidate.id === environmentId);

  return (
    <CreatePanel
      open={props.open}
      onClose={props.onClose}
      title={editing ? `Edit ${props.agent?.name}` : "New agent"}
      description={
        editing
          ? "Update the agent's role, runner, and access grants."
          : "Define the agent's role and access. All access is denied by default."
      }
      submitLabel={editing ? "Save" : "Create agent"}
      pending={save.isPending}
      disabled={!title.trim() || !rolePrompt.trim() || (!editing && !name.trim())}
      error={save.isError ? (save.error instanceof ApiError ? save.error.message : "Unable to save the agent.") : null}
      onSubmit={() => save.mutateAsync().then(() => undefined)}
    >
      <FormSection title="Identity">
        {!editing ? (
          <Field
            label="Name"
            required
            error={nameError}
            hint="Permanent lowercase identifier used by other agents."
          >
            {(id) => (
              <Input
                id={id}
                className="machine"
                value={name}
                placeholder="release-notes"
                autoComplete="off"
                spellCheck={false}
                onBlur={() => touch("name")}
                onChange={(event) => {
                  touch("name");
                  setName(event.target.value);
                }}
              />
            )}
          </Field>
        ) : null}

        <Field label="Title" required error={titleError} hint="Enter a short display title.">
          {(id) => (
            <Input
              id={id}
              value={title}
              placeholder="Release notes writer"
              onBlur={() => touch("title")}
              onChange={(event) => {
                touch("title");
                setTitle(event.target.value);
              }}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* What it is for, in one line. The role prompt below says how it
              works; this says whether you want it, and it is what the Agents
              grid and the assignee picker show. */}
          <Field
            label="Description"
            hint="What this agent is for, and when to assign it."
          >
            {(id) => (
              <Input
                id={id}
                value={description}
                placeholder="Writes release notes from the commit range and drafts the rollback."
                onChange={(event) => setDescription(event.target.value)}
              />
            )}
          </Field>

          <Field label="Category" hint="Groups this agent on the Agents page.">
            {(id) => (
              <Select
                id={id}
                value={category}
                onChange={(event) => setCategory(event.target.value as Category)}
              >
                {CATEGORIES.map((entry) => (
                  <option key={entry} value={entry}>
                    {CATEGORY_LABELS[entry]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <Field
          label="Role prompt"
          required
          error={rolePromptError}
          hint="Define the agent's responsibilities and operating instructions."
        >
          {(id) => (
            <Textarea
              id={id}
              rows={8}
              value={rolePrompt}
              onBlur={() => touch("rolePrompt")}
              onChange={(event) => {
                touch("rolePrompt");
                setRolePrompt(event.target.value);
              }}
            />
          )}
        </Field>
      </FormSection>

      <FormSection title="Runtime" hint="Select the model and execution environment.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Model">
            {(id) => (
              <Input
                id={id}
                className="machine"
                value={model}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setModel(event.target.value)}
              />
            )}
          </Field>
          <Field label="Runner" hint="Inherit uses the project's default runner.">
            {(id) => (
              <Select
                id={id}
                value={runnerPreference}
                onChange={(event) =>
                  setRunnerPreference(event.target.value as CreateAgentInput["runnerPreference"])
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
      </FormSection>

      {/*
        The four walls from PRODUCT.md, in the order a session hits them. Each
        one says what it refuses when it is empty, because default-deny holding
        is the state worth reading — a blank box only says the form is unfinished.
      */}
      <FormSection
        title="Access"
        hint="Only access explicitly granted below is permitted."
      >
        <Wall
          icon={<Server />}
          title="Network"
          labelFor={environmentFieldId}
          hint="Select the network policy applied to this agent."
        >
          <Select
            id={environmentFieldId}
            value={environmentId}
            onChange={(event) => setEnvironmentId(event.target.value)}
          >
            <option value="">None — no network access</option>
            {(environments.data ?? []).map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name} ({candidate.networking})
              </option>
            ))}
          </Select>
          {environment ? (
            <p className="text-xs leading-relaxed text-ink-muted">
              {environment.allowedHosts.length > 0 ? (
                <>
                  Reachable:{" "}
                  <span className="machine text-ink">{environment.allowedHosts.join(", ")}</span>
                </>
              ) : (
                <>
                  <span className="machine text-ink">{environment.networking}</span> networking with
                  no host list.
                </>
              )}
            </p>
          ) : (
            <DenyNote>
              No environment assigned. Network access is disabled.
            </DenyNote>
          )}
        </Wall>

        <Wall
          icon={<Blocks />}
          title="MCP tools"
          hint="Select the MCP connections available to this agent."
        >
          <IdListField
            label="MCP servers"
            options={(mcps.data ?? []).map((mcp) => ({ id: mcp.id, label: mcp.name }))}
            value={mcpConnectionIds}
            onChange={setMcpIds}
            none="No MCP connections assigned."
            empty="No MCP connections are available. Create one before assigning it to this agent."
          />
        </Wall>

        <Wall
          icon={<GitBranch />}
          title="Repositories"
          hint="Select repositories, mount paths, and Git permissions."
        >
          <RepoAccessField value={repoAccess} repos={repos.data ?? []} onChange={setRepoAccess} />
        </Wall>

        <Wall
          icon={<FolderTree />}
          title="Filesystem"
          hint="Grant read, write, and delete access to AgentOS filesystem paths."
        >
          <FilesystemGrantField value={filesystemGrants} onChange={setGrants} />
        </Wall>
      </FormSection>

      <FormSection
        title="Capabilities"
        hint="Assign skills, collaboration permissions, and inbox access."
      >
        <div className="space-y-2">
          <MicroLabel>Skills</MicroLabel>
          <IdListField
            label="Skills"
            options={(skills.data ?? []).map((skill) => ({ id: skill.id, label: skill.name }))}
            value={skillIds}
            onChange={setSkillIds}
            none="No skills assigned."
            empty="No skills are available. Create one before assigning it to this agent."
          />
        </div>

        <div className="space-y-2">
          <MicroLabel>May spawn</MicroLabel>
          <IdListField
            label="May spawn"
            options={(agents.data ?? [])
              .filter((candidate) => candidate.id !== props.agent?.id)
              .map((candidate) => ({ id: candidate.name, label: candidate.name }))}
            value={collaborationList}
            onChange={setCollaboration}
            none="Cannot start other agents."
            empty="No other agents are available in this project."
          />
        </div>

        <CheckboxField
          label="Allow this agent to request operator input through the inbox"
          checked={inboxAccess}
          onCheckedChange={setInboxAccess}
        />
        {inboxAccess ? null : (
          <DenyNote>
            Inbox access is disabled. The agent cannot request operator input.
          </DenyNote>
        )}
      </FormSection>
    </CreatePanel>
  );
}

/**
 * One labelled group of fields, separated from the one above it by a hairline.
 * The first section carries no rule because there is nothing above it to divide
 * it from.
 */
function FormSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section className="space-y-3 border-t border-edge pt-5 first:border-0 first:pt-0">
      <div className="space-y-1">
        <MicroLabel>{title}</MicroLabel>
        {hint ? <p className="text-xs leading-relaxed text-ink-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * One of the four walls. It is boxed rather than run inline with the rest of the
 * form because a grant is not a preference: the operator should be able to see
 * where one boundary stops and the next begins without reading the labels.
 */
function Wall({
  icon,
  title,
  hint,
  labelFor,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  /**
   * The id of the single control this wall holds, if it holds one. The heading
   * then *is* that control's `<label>` — the walls that hold a list of rows
   * label their own controls instead, and a second caption above them would
   * only say "Filesystem" twice.
   */
  labelFor?: string;
  children: ReactNode;
}): React.JSX.Element {
  const Heading = labelFor ? "label" : "p";
  return (
    <div className="space-y-3 rounded-panel border border-edge p-3">
      <div className="flex items-start gap-2.5">
        <IconTile size="sm">{icon}</IconTile>
        <div className="min-w-0">
          <Heading htmlFor={labelFor} className="block text-[13px] font-medium text-ink">
            {title}
          </Heading>
          <p className="text-xs leading-relaxed text-ink-muted">{hint}</p>
        </div>
      </div>
      {children}
    </div>
  );
}
