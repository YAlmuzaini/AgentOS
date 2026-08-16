#!/usr/bin/env node
/**
 * `agentos` — CLI against the control-plane API (SPEC §17).
 *
 * The intended shape of a day: brainstorm locally, then hand the result to
 * AgentOS with one command. The control plane stays the system of record —
 * this only ever talks to its API.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  call,
  callText,
  type Flags,
  parseFlags,
  print,
  projectId,
  required,
  YAML_FILE,
} from "./client";
import { inboxChoice } from "./inbox-choice";

const USAGE = `agentos — control plane CLI

Project as code
  agentos push [--project <slug>] [--file agentos.yml]   apply the local file
  agentos pull [--project <slug>] [--file agentos.yml]   write the project to the file

Reading
  agentos project list
  agentos agent list --project <slug>
  agentos task list --project <slug>

Creating
  agentos project create --name <name> --slug <slug>
  agentos task create --project <slug> --name <name> --agent <agent-name>
                      [--description <text>] [--gate] [--at <iso>] [--cron <expr> --tz <zone>]
  agentos goal create --project <slug> --title <title> --spec-file <path>
                      [--cap <usd> | --no-cap] [--max-minutes <n>]
  agentos agent create --project <slug> --agent <name> --title <text> --model <id>
                      --prompt-file <path> (--inbox | --no-inbox)
                      [--runner cloud|local|inherit] [--collaborators a,b]
  agentos agent update --project <slug> --agent <name> [--model <id>] [--prompt-file <path>]
                      [--title <text>] [--runner cloud|local|inherit] [--collaborators a,b]
                      [--inbox | --no-inbox]
  agentos skill create --project <slug> --slug <slug> --name <name>
                      [--body-file <path> | --kind file --file-path /skills/x.py]
  agentos template run --project <slug> --template <name> --var k=v [--var k=v ...]

Environment
  AGENTOS_API_URL           default http://localhost:3001
  AGENTOS_OPERATOR_TOKEN    required
  AGENTOS_FILE              default agentos.yml
`;

async function main(argv: string[]): Promise<number> {
  const [command, second, ...rest] = argv;
  // `push --file x` has no subcommand; `task create --name x` does.
  const subcommand = second && !second.startsWith("--") ? second : undefined;
  const flags = parseFlags(subcommand ? rest : [second ?? "", ...rest]);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return 0;
  }

  switch (`${command} ${subcommand ?? ""}`.trim()) {
    case "push":
      return push(flags);
    case "pull":
      return pull(flags);

    case "project list":
      return print(await call("/projects"));
    case "project create":
      return print(
        await call("/projects", {
          method: "POST",
          body: { name: required(flags.name, "--name"), slug: required(flags.slug, "--slug") },
        }),
      );

    case "agent list":
      return print(await call(`/projects/${await projectId(flags)}/agents`));
    case "agent create":
      return agentCreate(flags);
    case "agent update":
      return agentUpdate(flags);

    case "task list":
      return print(await call(`/projects/${await projectId(flags)}/tasks`));
    case "task create":
      return taskCreate(flags);

    case "goal create":
      return goalCreate(flags);

    case "skill create":
      return skillCreate(flags);

    case "template run":
      return templateRun(flags);

    default:
      process.stderr.write(`unknown command: ${command} ${subcommand ?? ""}\n\n${USAGE}`);
      return 1;
  }
}

/* ── project as code ───────────────────────────────────────────────────── */

async function push(flags: Flags): Promise<number> {
  const file = flags.file ?? YAML_FILE;
  const yaml = await readFile(path.resolve(file), "utf8");
  const id = await projectId(flags, yaml);
  const result = await call(`/projects/${id}/yaml`, { method: "PUT", body: { yaml } });
  return print(result);
}

async function pull(flags: Flags): Promise<number> {
  const file = flags.file ?? YAML_FILE;
  const id = await projectId(flags);
  const yaml = await callText(`/projects/${id}/yaml`);
  await writeFile(path.resolve(file), yaml, "utf8");
  process.stdout.write(`wrote ${file}\n`);
  return 0;
}

/* ── creating work ─────────────────────────────────────────────────────── */

async function taskCreate(flags: Flags): Promise<number> {
  const id = await projectId(flags);
  const agentName = required(flags.agent, "--agent");
  const agents = (await call(`/projects/${id}/agents`)) as Array<{ id: string; name: string }>;
  const agent = agents.find((candidate) => candidate.name === agentName);
  if (!agent) {
    throw new Error(`no agent named "${agentName}" in this project`);
  }

  const schedule = flags.cron
    ? { scheduleKind: "cron", cron: flags.cron, timezone: flags.tz ?? "UTC" }
    : flags.at
      ? { scheduleKind: "at", runAt: flags.at }
      : { scheduleKind: "now" };

  return print(
    await call(`/projects/${id}/tasks`, {
      method: "POST",
      body: {
        name: required(flags.name, "--name"),
        description: flags.description ?? "",
        assigneeType: "agent",
        assigneeAgentId: agent.id,
        approvalGate: "gate" in flags,
        ...schedule,
      },
    }),
  );
}

async function goalCreate(flags: Flags): Promise<number> {
  const id = await projectId(flags);
  const spec = await readFile(required(flags["spec-file"], "--spec-file"), "utf8");
  const noCap = "no-cap" in flags;

  const goal = await call(`/projects/${id}/goals`, {
    method: "POST",
    body: {
      title: required(flags.title, "--title"),
      spec,
      spendCapUsd: noCap ? null : Number(required(flags.cap, "--cap or --no-cap")),
      acknowledgeNoSpendCap: noCap,
      maxDurationMinutes: flags["max-minutes"] ? Number(flags["max-minutes"]) : null,
    },
  });

  process.stdout.write(
    `${JSON.stringify(goal, null, 2)}\n\n` +
      "The checklist above is a draft. Review it in the UI and approve it there —\n" +
      "nothing runs until you do.\n",
  );
  return 0;
}

/**
 * Creates an agent (SPEC §17: "adjust agents" is create *and* update).
 *
 * Grants are deliberately absent: repos, MCP connections and filesystem
 * folders are ids, and handing them out on a command line is how an operator
 * gives an agent something they meant to give another one. Those belong in
 * `agentos.yml`, where the whole shape is visible at once, or in the UI.
 */
async function agentCreate(flags: Flags): Promise<number> {
  const id = await projectId(flags);
  // Stated, not defaulted, and not guessed at when the flags contradict.
  const inboxAccess = inboxChoice(flags, true)!;
  return print(
    await call(`/projects/${id}/agents`, {
      method: "POST",
      body: {
        name: required(flags.agent, "--agent"),
        title: required(flags.title, "--title"),
        model: required(flags.model, "--model"),
        rolePrompt: await readFile(required(flags["prompt-file"], "--prompt-file"), "utf8"),
        runnerPreference: flags.runner ?? "inherit",
        collaborationList: splitList(flags.collaborators),
        inboxAccess,
      },
    }),
  );
}

/** A skill is a prompt or a file on the agent filesystem (SPEC §4). */
async function skillCreate(flags: Flags): Promise<number> {
  const id = await projectId(flags);
  const kind = flags.kind === "file" ? "file" : "prompt";
  return print(
    await call(`/projects/${id}/skills`, {
      method: "POST",
      body: {
        slug: required(flags.slug, "--slug"),
        name: required(flags.name, "--name"),
        kind,
        ...(kind === "file"
          ? { filePath: required(flags["file-path"], "--file-path"), body: "" }
          : { body: await readFile(required(flags["body-file"], "--body-file"), "utf8") }),
      },
    }),
  );
}

async function agentUpdate(flags: Flags): Promise<number> {
  const id = await projectId(flags);
  const name = required(flags.agent, "--agent");
  const agents = (await call(`/projects/${id}/agents`)) as Array<{ id: string; name: string }>;
  const agent = agents.find((candidate) => candidate.name === name);
  if (!agent) {
    throw new Error(`no agent named "${name}" in this project`);
  }

  const body: Record<string, unknown> = {};
  if (flags.model) {
    body.model = flags.model;
  }
  if (flags.title) {
    body.title = flags.title;
  }
  if (flags.runner) {
    body.runnerPreference = flags.runner;
  }
  if (flags.collaborators !== undefined) {
    body.collaborationList = splitList(flags.collaborators);
  }
  const inboxAccess = inboxChoice(flags, false);
  if (inboxAccess !== undefined) {
    body.inboxAccess = inboxAccess;
  }
  if (flags["prompt-file"]) {
    body.rolePrompt = await readFile(flags["prompt-file"], "utf8");
  }
  if (Object.keys(body).length === 0) {
    throw new Error(
      "nothing to update — pass --model, --title, --runner, --collaborators, " +
        "--inbox/--no-inbox and/or --prompt-file",
    );
  }
  return print(await call(`/projects/${id}/agents/${agent.id}`, { method: "PUT", body }));
}

/** `--collaborators plan,senior-dev` → `["plan", "senior-dev"]`. */
function splitList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function templateRun(flags: Flags): Promise<number> {
  const id = await projectId(flags);
  const name = required(flags.template, "--template");
  const templates = (await call(`/projects/${id}/templates`)) as Array<{ id: string; name: string }>;
  const template = templates.find((candidate) => candidate.name === name);
  if (!template) {
    throw new Error(`no template named "${name}" in this project`);
  }
  return print(
    await call(`/projects/${id}/templates/${template.id}/instantiate`, {
      method: "POST",
      body: { variables: flags.__vars ?? {}, titlePrefix: flags.prefix ?? "" },
    }),
  );
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
