import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { InboxService } from "../src/inbox/inbox.service";
import { SessionsService } from "../src/sessions/sessions.service";
import { createHarness, type Harness } from "./harness";

/**
 * A project is the isolation boundary (SPEC §4, §5.1), and the operator's own
 * screens have to honour it too.
 *
 * The grant path already did: `manifest.ts` resolves every repo, MCP, skill and
 * env binding with `projectId = agent.projectId`, so a stray id from another
 * project resolves to nothing rather than to someone else's credential. What
 * did not honour it were the two list endpoints with no project in their
 * path — `GET /inbox` and `GET /sessions`. Both returned everything.
 *
 * That was invisible while one project existed, which is exactly why it needs a
 * test: the failure only appears the day a second workspace is created, and it
 * appears as another project's questions sitting in this project's inbox.
 */
describe("operator lists are scoped to one project", () => {
  let harness: Harness;
  let inbox: InboxService;
  let sessions: SessionsService;

  beforeAll(async () => {
    harness = await createHarness();
    inbox = harness.app.get(InboxService);
    sessions = harness.app.get(SessionsService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  /** A second project with one agent, one parked question and one session. */
  async function seedOther(): Promise<string> {
    const [project] = await harness.db.execute<{ id: string }>(
      sql`INSERT INTO projects (name, slug) VALUES ('Other', 'other') RETURNING id`,
    );
    const projectId = project!.id;
    const [environment] = await harness.db.execute<{ id: string }>(
      sql`INSERT INTO environments (project_id, name, networking, allowed_hosts)
          VALUES (${projectId}, 'open', 'open', '[]'::jsonb) RETURNING id`,
    );
    const [agent] = await harness.db.execute<{ id: string }>(
      sql`INSERT INTO agents (project_id, name, title, model, foundational_prompt, role_prompt,
                              environment_id, runner_preference, inbox_access)
          VALUES (${projectId}, 'default', 'Default', 'claude-sonnet-5', '', '',
                  ${environment!.id}, 'inherit', true)
          RETURNING id`,
    );

    const session = await sessions.create({
      projectId,
      agentId: agent!.id,
      runner: "cloud",
    });
    await harness.db.execute(
      sql`INSERT INTO inbox_messages (project_id, "from", agent_id, session_id, kind, body, status)
          VALUES (${projectId}, 'agent', ${agent!.id}, ${session.id}, 'text',
                  'a question that belongs to the other project', 'open')`,
    );
    return projectId;
  }

  it("keeps another project's parked questions out of this project's inbox", async () => {
    const { projectId } = await harness.seedProject();
    const otherId = await seedOther();

    const mine = await inbox.list(projectId);
    const theirs = await inbox.list(otherId);

    expect(mine).toHaveLength(0);
    expect(theirs).toHaveLength(1);
    // Unfiltered is still the whole control plane — internal callers and the
    // maintenance sweep want that, and it is the shape the bug hid behind.
    expect(await inbox.list()).toHaveLength(1);
  });

  it("filters the inbox by project and status together", async () => {
    const otherId = await seedOther();

    expect(await inbox.list(otherId, "open")).toHaveLength(1);
    expect(await inbox.list(otherId, "answered")).toHaveLength(0);
  });

  it("keeps another project's sessions off this project's session list", async () => {
    const { projectId } = await harness.seedProject();
    const otherId = await seedOther();

    expect(await sessions.listSummaries(projectId)).toHaveLength(0);
    expect(await sessions.listSummaries(otherId)).toHaveLength(1);
    expect(await sessions.listSummaries()).toHaveLength(1);
  });
});
