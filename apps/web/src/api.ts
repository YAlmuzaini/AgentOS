import type {
  AgentDto,
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
  InboxMessageDto,
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

export const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const TOKEN_KEY = "agentos.operatorToken";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token.trim());
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Carries the HTTP status so the UI can tell "your token is wrong" apart from
 * "the control plane is down" apart from "there is genuinely nothing here".
 * Rendering all three as an empty page is how an operator ends up debugging a
 * seed script when the real problem is a stale token.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    });
  } catch (cause) {
    // fetch only rejects when the request never reached a server.
    throw new ApiError(0, `cannot reach the control plane at ${BASE}`, { cause });
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new ApiError(response.status, `${response.status} ${response.statusText} — ${detail}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/** Matches apps/api/src/activity/activity.service.ts — not published from @agentos/shared. */
export interface ActivityEntryDto {
  id: string;
  kind: "task-activity" | "session" | "inbox" | "goal";
  at: string;
  title: string;
  detail: string;
  taskId: string | null;
  sessionId: string | null;
  goalId: string | null;
}

export const api = {
  projects: () => request<ProjectDto[]>("/projects"),
  agents: (projectId: string) => request<AgentDto[]>(`/projects/${projectId}/agents`),
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
  taskActivity: (projectId: string, id: string) =>
    request<TaskActivityDto[]>(`/projects/${projectId}/tasks/${id}/activity`),

  // The list carries no tool-call log — fetch a single session to replay one.
  sessions: () => request<SessionSummaryDto[]>("/sessions"),
  session: (id: string) => request<SessionDto>(`/sessions/${id}`),

  inbox: (status?: string) =>
    request<InboxMessageDto[]>(`/inbox${status ? `?status=${status}` : ""}`),
  replyInbox: (id: string, body: { body?: string; selectedChoiceId?: string }) =>
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
