import { TASK_STATUSES } from "@agentos/shared";
import type { CustomToolDefinition } from "./runner.types";

/**
 * The AgentOS MCP and Inbox MCP of SPEC §4, implemented as custom tools rather
 * than a hosted MCP server.
 *
 * Deviation, deliberate: a custom tool call is answered by the control plane
 * over the session's own event stream, so there is no session-scoped token to
 * mint, hand to a container, or leak. The authority boundary is the same one
 * SPEC §20 asks for, enforced one layer earlier.
 */

export const TOOL_TASK_UPDATE = "agentos_update_task";
export const TOOL_TASK_NOTE = "agentos_add_activity";
export const TOOL_INBOX_SEND = "inbox_send";
export const TOOL_INBOX_ASK = "inbox_ask";

export const AGENTOS_TOOLS: CustomToolDefinition[] = [
  {
    name: TOOL_TASK_UPDATE,
    description:
      "Set the status of the task assigned to this session. Use 'doing' when you start, " +
      "'review' when work is ready for a human, and 'done' when the task is complete. " +
      "If the task is approval-gated you cannot set 'done' — leave it in 'review' and inbox the human.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: [...TASK_STATUSES] },
        note: {
          type: "string",
          description: "Optional one-line note recorded on the task activity log.",
        },
      },
      required: ["status"],
      additionalProperties: false,
    },
  },
  {
    name: TOOL_TASK_NOTE,
    description:
      "Record a progress note on the task activity log. Use this for notable progress. " +
      "Do not use it to ask the human anything — they are not watching.",
    inputSchema: {
      type: "object",
      properties: { note: { type: "string" } },
      required: ["note"],
      additionalProperties: false,
    },
  },
];

export const INBOX_TOOLS: CustomToolDefinition[] = [
  {
    name: TOOL_INBOX_SEND,
    description:
      "Send a message to the human operator's inbox. Use only when you are stuck or " +
      "need to hand something over. This does not wait for a reply.",
    inputSchema: {
      type: "object",
      properties: { body: { type: "string" } },
      required: ["body"],
      additionalProperties: false,
    },
  },
  {
    name: TOOL_INBOX_ASK,
    description:
      "Ask the human operator a question and wait for their answer. This pauses your " +
      "session until they reply, which may be hours. Use only when you need a decision " +
      "you cannot make yourself. Offer 2-4 concrete choices.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string" },
        choices: {
          type: "array",
          description: "The options to offer, as radio buttons.",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              label: { type: "string" },
            },
            required: ["id", "label"],
            additionalProperties: false,
          },
        },
      },
      required: ["question", "choices"],
      additionalProperties: false,
    },
  },
];

export const TOOL_FS_LIST = "fs_list";
export const TOOL_FS_READ = "fs_read";
export const TOOL_FS_WRITE = "fs_write";
export const TOOL_FS_MKDIR = "fs_mkdir";
export const TOOL_FS_DELETE = "fs_delete";

const pathOnly = {
  type: "object",
  properties: { path: { type: "string", description: "Absolute path, e.g. /agents/plan/notes.md" } },
  required: ["path"],
  additionalProperties: false,
} as const;

/**
 * The persistent filesystem (SPEC §7). Read, write and delete are separate
 * verbs on purpose: an agent that may write still cannot delete unless its
 * grant says so.
 */
export const FILESYSTEM_TOOLS: CustomToolDefinition[] = [
  {
    name: TOOL_FS_LIST,
    description:
      "List the persistent filesystem under a folder. This disk survives the session; " +
      "your container's local disk does not.",
    inputSchema: pathOnly as unknown as Record<string, unknown>,
  },
  {
    name: TOOL_FS_READ,
    description: "Read a file from the persistent filesystem.",
    inputSchema: pathOnly as unknown as Record<string, unknown>,
  },
  {
    name: TOOL_FS_WRITE,
    description:
      "Write a file to the persistent filesystem, creating or replacing it. Use this for " +
      "anything that must outlive the session and is not a git commit.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        mime: { type: "string", description: "Defaults to text/plain." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: TOOL_FS_MKDIR,
    description: "Create a folder on the persistent filesystem.",
    inputSchema: pathOnly as unknown as Record<string, unknown>,
  },
  {
    name: TOOL_FS_DELETE,
    description:
      "Delete a file from the persistent filesystem. Most agents are not granted this.",
    inputSchema: pathOnly as unknown as Record<string, unknown>,
  },
];

/** Grants are per agent: no inbox access means no inbox tools attached. */
export function toolsForAgent(input: { inboxAccess: boolean }): CustomToolDefinition[] {
  return [
    ...AGENTOS_TOOLS,
    ...FILESYSTEM_TOOLS,
    ...(input.inboxAccess ? INBOX_TOOLS : []),
  ];
}
