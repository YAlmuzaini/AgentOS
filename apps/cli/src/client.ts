/**
 * Transport and argument plumbing for the `agentos` CLI.
 *
 * Kept apart from the commands so the command bodies read as intent — what the
 * operator asked for — rather than as fetch calls.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

export const API_URL = process.env.AGENTOS_API_URL ?? "http://localhost:3001";
export const TOKEN = process.env.AGENTOS_OPERATOR_TOKEN ?? "";
export const YAML_FILE = process.env.AGENTOS_FILE ?? "agentos.yml";

export type Flags = Record<string, string> & { __vars?: Record<string, string> };




/** Resolves a project slug to its id, defaulting to the file's own project. */
export async function projectId(flags: Flags, yamlText?: string): Promise<string> {
  const slug =
    flags.project ??
    (yamlText ? /^project:\s*(\S+)/m.exec(yamlText)?.[1] : undefined) ??
    (await readProjectFromFile(flags.file ?? YAML_FILE));

  const projects = (await call("/projects")) as Array<{ id: string; slug: string }>;
  if (!slug) {
    if (projects.length === 1) {
      return projects[0]!.id;
    }
    throw new Error("pass --project <slug> (more than one project exists)");
  }
  const match = projects.find((project) => project.slug === slug);
  if (!match) {
    throw new Error(`no project with slug "${slug}"`);
  }
  return match.id;
}

async function readProjectFromFile(file: string): Promise<string | undefined> {
  try {
    const text = await readFile(path.resolve(file), "utf8");
    return /^project:\s*(\S+)/m.exec(text)?.[1];
  } catch {
    return undefined;
  }
}

export async function call(
  route: string,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const response = await fetchWithAuth(route, init);
  return response.json();
}

export async function callText(route: string): Promise<string> {
  const response = await fetchWithAuth(route, {});
  return response.text();
}

async function fetchWithAuth(
  route: string,
  init: { method?: string; body?: unknown },
): Promise<Response> {
  if (!TOKEN) {
    throw new Error("AGENTOS_OPERATOR_TOKEN is not set");
  }
  const response = await fetch(`${API_URL}${route}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} — ${await response.text()}`);
  }
  return response;
}

export function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  const vars: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    const value = next && !next.startsWith("--") ? next : "true";
    if (next && !next.startsWith("--")) {
      index += 1;
    }
    if (key === "var") {
      const separator = value.indexOf("=");
      if (separator > 0) {
        vars[value.slice(0, separator)] = value.slice(separator + 1);
      }
      continue;
    }
    flags[key] = value;
  }
  if (Object.keys(vars).length > 0) {
    flags.__vars = vars;
  }
  return flags;
}

export function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`missing ${label}`);
  }
  return value;
}

export function print(payload: unknown): number {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  return 0;
}
