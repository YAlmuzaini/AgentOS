import type {
  AgentDto,
  CreateAgentInput,
  UpdateAgentInput,
  ApproveDodInput,
  AutomationDto,
  CreateAutomationInput,
  CreateEnvBindingInput,
  CreateEnvironmentInput,
  CreateGoalInput,
  CreateMcpConnectionInput,
  CreateProjectInput,
  UpdateProjectInput,
  CreateRepoInput,
  CreateSecretRefInput,
  CreateSkillInput,
  CreateTaskInput,
  CreateTriggerInput,
  EnvBindingDto,
  EnvironmentDto,
  FileEntryDto,
  GithubStatusDto,
  GoalDto,
  RemoteRepoDto,
  InstantiateTemplateInput,
  InboxAnswer,
  InboxMessageDto,
  RunnerStatusDto,
  McpConnectionDto,
  McpSeed,
  UpdateMcpConnectionInput,
  CatalogPack,
  PatchTaskInput,
  ProjectDto,
  RepoDto,
  SecretRefDto,
  SessionDto,
  SessionSummaryDto,
  SettingsDto,
  SkillDto,
  TaskActivityDto,
  TaskDto,
  TaskTemplateDto,
  TriggerDto,
  TriggerFireDto,
  TriggerSecretDto,
  UpdateEnvironmentInput,
  UpdateSettingsInput,
  WriteFileInput,
  CompanyBlueprint,
  BlueprintPreview,
  BlueprintInstallationDto,
  ApplyBlueprintInput,
  ResourceSlotDto,
  ResolveResourceSlotInput,
  PreflightReport,
  HandoffDto,
  ExecutiveBriefingDto,
  RunPreflightInput,
} from "@agentos/shared";
import { request, requestBlob, upload } from "./api-client";

// Re-exported so every existing `from "../api"` import keeps working: this file
// is still the front door, it just no longer carries the transport as well.
export { ApiError, BASE, clearToken, getToken, setToken } from "./api-client";
export type { ActivityEntryDto } from "./api-client";
import type { ActivityEntryDto } from "./api-client";

/** Drops the keys that are absent, so an unset filter never becomes `?x=undefined`. */
function query(params: Record<string, string | undefined>): string {
  const pairs = Object.entries(params).filter(([, value]) => value != null && value !== "");
  if (pairs.length === 0) {
    return "";
  }
  return `?${pairs.map(([key, value]) => `${key}=${encodeURIComponent(value!)}`).join("&")}`;
}

export const api = {
  projects: () => request<ProjectDto[]>("/projects"),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: "DELETE" }),
  createProject: (body: CreateProjectInput) =>
    request<ProjectDto>("/projects", { method: "POST", body: JSON.stringify(body) }),
  // PUT, matching the controller — a PATCH here 404s, which reads in the UI as
  // a rename that silently did nothing.
  updateProject: (id: string, body: UpdateProjectInput) =>
    request<ProjectDto>(`/projects/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  companyBlueprints: () => request<CompanyBlueprint[]>("/company-blueprints"),
  blueprintPreview: (projectId: string, slug: string) =>
    request<BlueprintPreview>(`/projects/${projectId}/company-blueprints/${slug}/preview`),
  applyBlueprint: (projectId: string, slug: string, body: ApplyBlueprintInput) =>
    request<BlueprintInstallationDto>(`/projects/${projectId}/company-blueprints/${slug}/apply`, { method: "POST", body: JSON.stringify(body) }),
  blueprintInstallations: (projectId: string) =>
    request<BlueprintInstallationDto[]>(`/projects/${projectId}/company-blueprints`),
  resourceSlots: (projectId: string) =>
    request<ResourceSlotDto[]>(`/projects/${projectId}/resource-slots`),
  resolveResourceSlot: (projectId: string, key: string, body: ResolveResourceSlotInput) =>
    request<ResourceSlotDto>(`/projects/${projectId}/resource-slots/${key}`, { method: "PUT", body: JSON.stringify(body) }),
  preflight: (projectId: string, subjectType: "project" | "template" | "goal" = "project", subjectId?: string) =>
    request<PreflightReport>(`/projects/${projectId}/capabilities/preflight${query({ subjectType, subjectId })}`),
  preflightWithInputs: (projectId: string, body: RunPreflightInput) =>
    request<PreflightReport>(`/projects/${projectId}/capabilities/preflight`, { method: "POST", body: JSON.stringify(body) }),
  handoffs: (projectId: string, scope: { taskId?: string; goalId?: string } = {}) =>
    request<HandoffDto[]>(`/projects/${projectId}/handoffs${query(scope)}`),
  briefing: (projectId: string, since?: string) =>
    request<ExecutiveBriefingDto>(`/projects/${projectId}/briefing${query({ since })}`),
  agents: (projectId: string) => request<AgentDto[]>(`/projects/${projectId}/agents`),
  createAgent: (projectId: string, body: CreateAgentInput) =>
    request<AgentDto>(`/projects/${projectId}/agents`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  /** Everything except the name, which is the identity other agents refer to. */
  updateAgent: (projectId: string, id: string, body: UpdateAgentInput) =>
    request<AgentDto>(`/projects/${projectId}/agents/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteAgent: (projectId: string, id: string) =>
    request<void>(`/projects/${projectId}/agents/${id}`, { method: "DELETE" }),
  installBuiltInAgents: (projectId: string) =>
    request<AgentDto[]>(`/projects/${projectId}/agents/install-built-ins`, { method: "POST" }),
  agent: (projectId: string, id: string) =>
    request<AgentDto>(`/projects/${projectId}/agents/${id}`),

  tasks: (projectId: string) => request<TaskDto[]>(`/projects/${projectId}/tasks`),
  createTask: (projectId: string, body: Partial<CreateTaskInput>) =>
    request<TaskDto>(`/projects/${projectId}/tasks`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  patchTask: (projectId: string, id: string, body: PatchTaskInput) =>
    request<TaskDto>(`/projects/${projectId}/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  runTask: (projectId: string, id: string) =>
    request<{ enqueued: true }>(`/projects/${projectId}/tasks/${id}/run`, { method: "POST" }),
  /** Removing a task. Refused by the server while a session still runs on it. */
  deleteTask: (projectId: string, id: string) =>
    request<void>(`/projects/${projectId}/tasks/${id}`, { method: "DELETE" }),
  taskActivity: (projectId: string, id: string) =>
    request<TaskActivityDto[]>(`/projects/${projectId}/tasks/${id}/activity`),
  /** The files this card carries into every step and collaborator after it. */
  taskAttachments: (projectId: string, id: string) =>
    request<FileEntryDto[]>(`/projects/${projectId}/tasks/${id}/attachments`),

  // The list carries no tool-call log — fetch a single session to replay one.
  // `projectId` is not optional in practice: a session list that spans projects
  // shows the operator runs they cannot open, from agents that are not on their
  // Agents page.
  sessions: (projectId?: string) =>
    request<SessionSummaryDto[]>(`/sessions${projectId ? `?projectId=${projectId}` : ""}`),
  session: (id: string) => request<SessionDto>(`/sessions/${id}`),
  deleteSession: (id: string) => request<void>(`/sessions/${id}`, { method: "DELETE" }),

  inbox: (projectId?: string, status?: string) =>
    request<InboxMessageDto[]>(
      `/inbox${query({ projectId, status })}`,
    ),
  /**
   * One subject's thread, oldest first (SPEC §11, §12).
   *
   * A goal's is shared across every specialist that worked it; a task's is how
   * a sequence of questions from the same card reads as one conversation
   * rather than as unrelated cards in a flat list.
   */
  inboxThread: (projectId: string, subject: { goalId?: string; taskId?: string }) =>
    request<InboxMessageDto[]>(
      `/inbox?projectId=${projectId}&` +
        (subject.goalId ? `goalId=${subject.goalId}` : `taskId=${subject.taskId}`),
    ),
  goalInbox: (projectId: string, goalId: string) =>
    request<InboxMessageDto[]>(`/inbox?projectId=${projectId}&goalId=${goalId}`),
  replyInbox: (
    id: string,
    body: { body?: string; selectedChoiceId?: string; answers?: InboxAnswer[] },
  ) =>
    request<InboxMessageDto>(`/inbox/${id}/reply`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  environments: (projectId: string) =>
    request<EnvironmentDto[]>(`/projects/${projectId}/environments`),
  deleteEnvironment: (projectId: string, id: string) =>
    request<void>(`/projects/${projectId}/environments/${id}`, { method: "DELETE" }),
  createEnvironment: (projectId: string, body: CreateEnvironmentInput) =>
    request<EnvironmentDto>(`/projects/${projectId}/environments`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateEnvironment: (projectId: string, id: string, body: UpdateEnvironmentInput) =>
    request<EnvironmentDto>(`/projects/${projectId}/environments/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  mcpConnections: (projectId: string) =>
    request<McpConnectionDto[]>(`/projects/${projectId}/mcp-connections`),
  deleteMcpConnection: (projectId: string, id: string) =>
    request<void>(`/projects/${projectId}/mcp-connections/${id}`, { method: "DELETE" }),
  /** The connections AgentOS ships, as data — hosts and credential names included. */
  mcpCatalog: (projectId: string) =>
    request<McpSeed[]>(`/projects/${projectId}/mcp-connections/catalog`),
  installBuiltInMcp: (projectId: string) =>
    request<McpConnectionDto[]>(`/projects/${projectId}/mcp-connections/install-built-ins`, {
      method: "POST",
    }),
  updateMcpConnection: (projectId: string, id: string, body: UpdateMcpConnectionInput) =>
    request<McpConnectionDto>(`/projects/${projectId}/mcp-connections/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  /** Operator-triggered handshake. Never called automatically. */
  verifyMcpConnection: (projectId: string, id: string) =>
    request<McpConnectionDto>(`/projects/${projectId}/mcp-connections/${id}/verify`, {
      method: "POST",
    }),
  agentPacks: (projectId: string) =>
    request<CatalogPack[]>(`/projects/${projectId}/agents/packs`),
  installAgentPack: (projectId: string, slug: string) =>
    request<AgentDto[]>(`/projects/${projectId}/agents/packs/${slug}/install`, { method: "POST" }),
  createMcpConnection: (projectId: string, body: CreateMcpConnectionInput) =>
    request<McpConnectionDto>(`/projects/${projectId}/mcp-connections`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /* GitHub App — connecting a repo without a personal access token. */
  githubStatus: (projectId: string) =>
    request<GithubStatusDto>(`/projects/${projectId}/github/status`),
  githubInstallUrl: (projectId: string) =>
    request<{ url: string }>(`/projects/${projectId}/github/install-url`),
  githubRepositories: (projectId: string, installationId: string) =>
    request<RemoteRepoDto[]>(
      `/projects/${projectId}/github/installations/${installationId}/repositories`,
    ),
  disconnectGithub: (projectId: string, installationId: string) =>
    request<void>(`/projects/${projectId}/github/installations/${installationId}`, {
      method: "DELETE",
    }),

  repos: (projectId: string) => request<RepoDto[]>(`/projects/${projectId}/repos`),
  deleteRepo: (projectId: string, id: string) =>
    request<void>(`/projects/${projectId}/repos/${id}`, { method: "DELETE" }),
  createRepo: (projectId: string, body: CreateRepoInput) =>
    request<RepoDto>(`/projects/${projectId}/repos`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  skills: (projectId: string) => request<SkillDto[]>(`/projects/${projectId}/skills`),
  installBuiltInSkills: (projectId: string) =>
    request<SkillDto[]>(`/projects/${projectId}/skills/install-built-ins`, { method: "POST" }),
  deleteSkill: (projectId: string, id: string) =>
    request<void>(`/projects/${projectId}/skills/${id}`, { method: "DELETE" }),
  createSkill: (projectId: string, body: CreateSkillInput) =>
    request<SkillDto>(`/projects/${projectId}/skills`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  settings: (projectId: string) => request<SettingsDto>(`/projects/${projectId}/settings`),
  /**
   * Which backends can actually take a session. Not project-scoped: where the
   * local worker lives is one env var for the whole process.
   */
  runnerStatus: () => request<RunnerStatusDto>("/runners"),
  setLocalRunnerDrain: (draining: boolean) =>
    request<RunnerStatusDto["local"]>("/runners/local/drain", { method: "POST", body: JSON.stringify({ draining }) }),
  updateSettings: (projectId: string, body: UpdateSettingsInput) =>
    request<SettingsDto>(`/projects/${projectId}/settings`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  envBindings: (projectId: string) =>
    request<EnvBindingDto[]>(`/projects/${projectId}/env-bindings`),
  createEnvBinding: (projectId: string, body: CreateEnvBindingInput) =>
    request<EnvBindingDto>(`/projects/${projectId}/env-bindings`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  secrets: (projectId: string) => request<SecretRefDto[]>(`/projects/${projectId}/secrets`),
  createSecret: (projectId: string, body: CreateSecretRefInput) =>
    request<SecretRefDto>(`/projects/${projectId}/secrets`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteSecret: (projectId: string, id: string) =>
    request<void>(`/projects/${projectId}/secrets/${id}`, { method: "DELETE" }),

  files: (projectId: string, path: string) =>
    request<FileEntryDto[]>(`/projects/${projectId}/files?path=${encodeURIComponent(path)}`),
  fileContent: (projectId: string, path: string) =>
    request<{ path: string; content: string; mime: string }>(
      `/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`,
    ),
  // Returns the written directory entry, not the content that was just sent.
  writeFileContent: (projectId: string, body: WriteFileInput) =>
    request<FileEntryDto>(`/projects/${projectId}/files/content`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteFileContent: (projectId: string, path: string) =>
    request<void>(`/projects/${projectId}/files/content?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    }),
  /** The id behind a path, for attaching a file to a card. */
  fileId: (projectId: string, path: string) =>
    request<{ id: string; path: string }>(
      `/projects/${projectId}/files/id?path=${encodeURIComponent(path)}`,
    ),
  /** The raw bytes — for a download, or an inline preview of an image. */
  fileBytes: (projectId: string, path: string) =>
    requestBlob(`/projects/${projectId}/files/download?path=${encodeURIComponent(path)}`),
  uploadFile: (projectId: string, path: string, file: File) =>
    upload<FileEntryDto>(
      `/projects/${projectId}/files/upload?path=${encodeURIComponent(path)}`,
      file,
    ),

  goals: (projectId: string) => request<GoalDto[]>(`/projects/${projectId}/goals`),
  goal: (projectId: string, id: string) =>
    request<GoalDto>(`/projects/${projectId}/goals/${id}`),
  deleteGoal: (projectId: string, id: string) =>
    request<void>(`/projects/${projectId}/goals/${id}`, { method: "DELETE" }),
  createGoal: (projectId: string, body: Partial<CreateGoalInput>) =>
    request<GoalDto>(`/projects/${projectId}/goals`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  approveGoalDod: (projectId: string, id: string, body: ApproveDodInput) =>
    request<GoalDto>(`/projects/${projectId}/goals/${id}/approve-dod`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  pauseGoal: (projectId: string, id: string) =>
    request<GoalDto>(`/projects/${projectId}/goals/${id}/pause`, { method: "POST" }),
  resumeGoal: (projectId: string, id: string) =>
    request<GoalDto>(`/projects/${projectId}/goals/${id}/resume`, { method: "POST" }),

  triggers: (projectId: string) => request<TriggerDto[]>(`/projects/${projectId}/triggers`),
  deleteTrigger: (projectId: string, id: string) =>
    request<void>(`/projects/${projectId}/triggers/${id}`, { method: "DELETE" }),
  createTrigger: (projectId: string, body: CreateTriggerInput) =>
    request<TriggerSecretDto>(`/projects/${projectId}/triggers`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  rotateTriggerSecret: (projectId: string, id: string) =>
    request<TriggerSecretDto>(`/projects/${projectId}/triggers/${id}/rotate-secret`, {
      method: "POST",
    }),
  triggerFires: (projectId: string, id: string) =>
    request<TriggerFireDto[]>(`/projects/${projectId}/triggers/${id}/fires`),
  /**
   * Installs the example webhook triggers, for a project starting from nothing.
   *
   * Returns the signing keys, which the server shows exactly once. Typing this
   * as plain `TriggerDto[]` threw them away silently: the triggers appeared,
   * their keys did not, and each had to be rotated before it could be used.
   */
  installExampleTriggers: (projectId: string) =>
    request<TriggerSecretDto[]>(`/projects/${projectId}/triggers/install-examples`, {
      method: "POST",
    }),

  automations: (projectId: string) =>
    request<AutomationDto[]>(`/projects/${projectId}/automations`),
  deleteAutomation: (projectId: string, id: string) =>
    request<void>(`/projects/${projectId}/automations/${id}`, { method: "DELETE" }),
  createAutomation: (projectId: string, body: Partial<CreateAutomationInput>) =>
    request<AutomationDto>(`/projects/${projectId}/automations`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  enableAutomation: (projectId: string, id: string) =>
    request<AutomationDto>(`/projects/${projectId}/automations/${id}/enable`, {
      method: "POST",
    }),
  disableAutomation: (projectId: string, id: string) =>
    request<AutomationDto>(`/projects/${projectId}/automations/${id}/disable`, {
      method: "POST",
    }),
  runAutomation: (projectId: string, id: string) =>
    request<{ taskIds: string[] }>(`/projects/${projectId}/automations/${id}/run`, {
      method: "POST",
    }),

  templates: (projectId: string) =>
    request<TaskTemplateDto[]>(`/projects/${projectId}/templates`),
  deleteTemplate: (projectId: string, id: string) =>
    request<void>(`/projects/${projectId}/templates/${id}`, { method: "DELETE" }),
  /** Re-installs the built-in workflows over whatever is there. */
  installBuiltInTemplates: (projectId: string) =>
    request<TaskTemplateDto[]>(`/projects/${projectId}/templates/install-built-ins`, {
      method: "POST",
    }),
  /** Creates every card in the chain at once; returns them in step order. */
  instantiateTemplate: (projectId: string, id: string, body: InstantiateTemplateInput) =>
    request<TaskDto[]>(`/projects/${projectId}/templates/${id}/instantiate`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  activity: (projectId: string, limit = 100) =>
    request<ActivityEntryDto[]>(`/projects/${projectId}/activity?limit=${limit}`),

  pushPublicKey: () => request<{ publicKey: string; enabled: boolean }>("/push/public-key"),
  pushSubscribe: (body: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    request<{ ok: true }>("/push/subscribe", {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
