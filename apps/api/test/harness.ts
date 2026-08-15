import { execFileSync } from "node:child_process";
import path from "node:path";
import { type Database } from "@agentos/db";
import { FOUNDATIONAL_PROMPT, ROLE_SEEDS } from "@agentos/shared";
import { type INestApplication } from "@nestjs/common";
import { Test, type TestingModuleBuilder } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import { AppModule } from "../src/app.module";
import { DATABASE } from "../src/db/db.module";
import { RUNNER_CLOUD } from "../src/runner/runner.types";
import { FakeRunner } from "./fake-runner";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://agentos:agentos@localhost:5433/agentos_test";

export interface Harness {
  app: INestApplication;
  db: Database;
  runner: FakeRunner;
  token: string;
  close(): Promise<void>;
  reset(): Promise<void>;
  /** Creates a project, an environment and every seeded role agent. */
  seedProject(): Promise<{ projectId: string; agentIds: Record<string, string> }>;
}

let migrated = false;

/** Creates the test database and applies migrations once per test run. */
function ensureDatabase(): void {
  if (migrated) {
    return;
  }
  const admin = TEST_DATABASE_URL.replace(/\/[^/]+$/, "/postgres");
  const name = TEST_DATABASE_URL.split("/").pop()!;
  try {
    execFileSync("psql", [admin, "-c", `CREATE DATABASE ${name}`], { stdio: "pipe" });
  } catch {
    // Already exists — fine.
  }
  execFileSync("pnpm", ["--filter", "@agentos/db", "run", "migrate"], {
    cwd: path.resolve(__dirname, "../../.."),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
  migrated = true;
}

export interface HarnessOptions {
  /** Swap a provider before the module compiles, e.g. a scripted evaluator. */
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  ensureDatabase();

  const token = "test-operator-token-0000000000000000";
  Object.assign(process.env, {
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6380",
    AGENTOS_OPERATOR_TOKEN: token,
    AGENTOS_DISABLE_WORKER: "1",
    ANTHROPIC_API_KEY: "test-key",
  });

  const runner = new FakeRunner();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RUNNER_CLOUD)
    .useValue(runner);
  if (options.override) {
    builder = options.override(builder);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  const db = app.get<Database>(DATABASE);

  const harness: Harness = {
    app,
    db,
    runner,
    token,
    async close() {
      await app.close();
    },
    async reset() {
      runner.reset();
      // Discovered rather than listed, so a new table in a later phase does not
      // silently leak state between tests.
      const rows = await db.execute<{ tablename: string }>(sql`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'
      `);
      const names = rows.map((row) => `"${row.tablename}"`).join(", ");
      if (names) {
        await db.execute(sql.raw(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`));
      }
    },
    async seedProject() {
      const [project] = await db.execute<{ id: string }>(
        sql`INSERT INTO projects (name, slug) VALUES ('Test', 'test') RETURNING id`,
      );
      const projectId = project!.id;

      await db.execute(sql`
        INSERT INTO environments (project_id, name, networking, allowed_hosts)
        VALUES (${projectId}, 'limited-none', 'limited', '[]'::jsonb),
               (${projectId}, 'open', 'open', '[]'::jsonb)
      `);

      const agentIds: Record<string, string> = {};
      for (const role of ROLE_SEEDS) {
        const [row] = await db.execute<{ id: string }>(sql`
          INSERT INTO agents (project_id, name, title, model, foundational_prompt, role_prompt, runner_preference)
          VALUES (${projectId}, ${role.name}, ${role.title}, 'claude-opus-5',
                  ${FOUNDATIONAL_PROMPT}, ${role.rolePrompt}, 'cloud')
          RETURNING id
        `);
        agentIds[role.name] = row!.id;
      }
      return { projectId, agentIds };
    },
  };

  await harness.reset();
  return harness;
}

/** Bearer header for operator-authenticated requests. */
export function auth(harness: Harness): Record<string, string> {
  return { authorization: `Bearer ${harness.token}` };
}
