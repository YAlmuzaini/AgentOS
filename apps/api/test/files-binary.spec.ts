import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FilesService } from "../src/files/files.service";
import { SessionOrchestrator } from "../src/runner/session-orchestrator";
import { TasksService } from "../src/tasks/tasks.service";
import { createHarness, type Harness } from "./harness";

/**
 * The filesystem holds blobs, not only text (SPEC §7, §18).
 *
 * A binary object read as text is mojibake with a wrong byte count, and an
 * editor that saved it back would corrupt it — so the read refuses and the
 * bytes come out of the download path instead.
 */
describe("binary files", () => {
  let harness: Harness;
  let files: FilesService;
  let tasks: TasksService;
  let orchestrator: SessionOrchestrator;

  beforeAll(async () => {
    harness = await createHarness();
    files = harness.app.get(FilesService);
    tasks = harness.app.get(TasksService);
    orchestrator = harness.app.get(SessionOrchestrator);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
  });

  const png = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489",
    "hex",
  );

  it("round-trips bytes through upload and download", async () => {
    const { projectId } = await harness.seedProject();
    const entry = await files.writeBytes(projectId, "/agents/spec/mock.png", png, "image/png");
    expect(entry.size).toBe(png.byteLength);

    const read = await files.readBytes(projectId, "/agents/spec/mock.png");
    expect(read.bytes.equals(png)).toBe(true);
    expect(read.mime).toBe("image/png");
  });

  it("refuses a text read of a binary object", async () => {
    const { projectId } = await harness.seedProject();
    await files.writeBytes(projectId, "/agents/spec/mock.png", png, "image/png");
    await expect(files.read(projectId, "/agents/spec/mock.png")).rejects.toThrow(/not text/);
  });

  it("tells an agent what it found instead of handing it mojibake", async () => {
    const { projectId, agentIds } = await harness.seedProject();
    await files.writeBytes(projectId, "/agents/spec/mock.png", png, "image/png");
    const task = await tasks.create(projectId, {
      name: "Look at the mock",
      description: "",
      assigneeType: "agent",
      assigneeAgentId: agentIds.spec!,
      attachmentIds: [],
      approvalGate: false,
      scheduleKind: "now",
      runAt: null,
      cron: null,
      timezone: null,
    });

    harness.runner.setScript([
      { kind: "tool", call: { name: "fs_read", input: { path: "/agents/spec/mock.png" } } },
    ]);
    await orchestrator.runTask(task.id);

    const result = harness.runner.injectedResults.at(0)?.result ?? "";
    expect(result).toMatch(/refused/);
    expect(result).toMatch(/image\/png/);
  });

  it("still reads a text file whose mime says nothing useful", async () => {
    const { projectId } = await harness.seedProject();
    // Written by an agent with no mime hint at all — the extension decides.
    await files.writeBytes(
      projectId,
      "/agents/spec/plan.md",
      Buffer.from("# Plan", "utf8"),
      "application/octet-stream",
    );
    expect((await files.read(projectId, "/agents/spec/plan.md")).content).toBe("# Plan");
  });
});
