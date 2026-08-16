import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { inheritableEnv } from "./env.js";
import type { CustomToolDefinition } from "./protocol.js";

/**
 * The workspace toolset for the Grok engine.
 *
 * Claude Code brings its own shell and editor; an OpenAI-compatible model
 * brings nothing, so a session that has to touch a repository needs these.
 * Every path is resolved inside the session's throwaway directory and refused
 * if it lands outside — the same rule the clone path applies, for the same
 * reason: this directory is the only thing that gets cleaned up.
 *
 * The shell has no approval prompt. That is what "yolo mode" means in SPEC
 * §16, and the honest reading is that the confinement here is the directory,
 * the session ceilings, and the unix user this worker runs as — not a dialog.
 */
const SHELL_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT_CHARS = 20_000;

export const WORKSPACE_TOOLS: CustomToolDefinition[] = [
  {
    name: "workspace_shell",
    description:
      "Run a shell command in the session workspace. Use it for git, builds and tests. " +
      "Output is truncated; there is no approval prompt and no human watching.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: { type: "string", description: "Relative to the workspace root." },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    name: "workspace_read",
    description: "Read a file from the session workspace.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "workspace_write",
    description: "Write a file in the session workspace, creating parent folders.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "workspace_list",
    description: "List a folder in the session workspace.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
];

export async function runWorkspaceTool(
  root: string,
  name: string,
  args: Record<string, unknown>,
  /** Extra environment for spawned commands: granted vars, and the egress proxy. */
  env: Record<string, string> = {},
): Promise<string> {
  try {
    switch (name) {
      case "workspace_shell":
        return await shell(root, String(args.command ?? ""), String(args.cwd ?? "."), env);
      case "workspace_read":
        return await readFile(inside(root, String(args.path ?? "")), "utf8");
      case "workspace_write": {
        const target = inside(root, String(args.path ?? ""));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, String(args.content ?? ""), "utf8");
        return `wrote ${args.path}`;
      }
      case "workspace_list": {
        const entries = await readdir(inside(root, String(args.path ?? ".")), {
          withFileTypes: true,
        });
        return entries.map((entry) => `${entry.isDirectory() ? "d" : "-"} ${entry.name}`).join("\n");
      }
      default:
        return `refused: unknown workspace tool "${name}"`;
    }
  } catch (error) {
    return `refused: ${String(error)}`;
  }
}

function inside(root: string, path: string): string {
  const target = resolve(root, path.replace(/^\/+/, ""));
  const rel = relative(root, target);
  if (rel.startsWith("..") || resolve(root, rel) !== target) {
    throw new Error(`${path} is outside the session workspace`);
  }
  return target;
}

function shell(
  root: string,
  command: string,
  cwd: string,
  env: Record<string, string>,
): Promise<string> {
  if (!command.trim()) {
    return Promise.resolve("refused: command is empty");
  }
  const workingDir = inside(root, cwd === "." ? "" : cwd);
  return new Promise((resolvePromise) => {
    const child = spawn("bash", ["-lc", command], {
      cwd: workingDir || root,
      // Credentials are stripped the same way the Claude engine strips them:
      // this shell belongs to the agent, not to the worker.
      env: { ...inheritableEnv(), ...env },
    });
    let output = "";
    const append = (chunk: Buffer) => {
      if (output.length < MAX_OUTPUT_CHARS) {
        output += chunk.toString();
      }
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      output += `\n(killed after ${SHELL_TIMEOUT_MS / 60_000} minutes)`;
    }, SHELL_TIMEOUT_MS);
    timer.unref?.();

    child.on("error", (error) => {
      clearTimeout(timer);
      resolvePromise(`refused: ${String(error)}`);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const body = output.slice(0, MAX_OUTPUT_CHARS);
      resolvePromise(`exit ${code ?? "?"}\n${body || "(no output)"}`);
    });
  });
}
