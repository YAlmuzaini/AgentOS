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
  CreateRepoInput,
  CreateSecretRefInput,
  CreateSkillInput,
  CreateTaskInput,
  CreateTriggerInput,
  EnvBindingDto,
  EnvironmentDto,
  FileEntryDto,
  GoalDto,
  InstantiateTemplateInput,
  InboxAnswer,
  InboxMessageDto,
  RunnerStatusDto,
  McpConnectionDto,
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
} from "@agentos/shared";
import { request, requestBlob, upload } from "./api-client";

// Re-exported so every existing `from "../api"` import keeps working: this file
// is still the front door, it just no longer carries the transport as well.
export { ApiError, BASE, clearToken, getToken, setToken } from "./api-client";
export type { ActivityEntryDto } from "./api-client";
import type { ActivityEntryDto } from "./api-client";

export const api = {
  projects: () => request<ProjectDto[]>("/projects"),
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
  sessions: () => request<SessionSummaryDto[]>("/sessions"),
  session: (id: string) => request<SessionDto>(`/sessions/${id}`),

  inbox: (status?: string) =>
    request<InboxMessageDto[]>(`/inbox${status ? `?status=${status}` : ""}`),
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
  createMcpConnection: (projectId: string, body: CreateMcpConnectionInput) =>
    request<McpConnectionDto>(`/projects/${projectId}/mcp-connections`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  repos: (projectId: string) => request<RepoDto[]>(`/projects/${projectId}/repos`),
  createRepo: (projectId: string, body: CreateRepoInput) =>
    request<RepoDto>(`/projects/${projectId}/repos`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  skills: (projectId: string) => request<SkillDto[]>(`/projects/${projectId}/skills`),
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
