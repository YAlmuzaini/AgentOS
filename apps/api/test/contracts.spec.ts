import {
  createRepoSchema,
  documentRepoSchema,
  documentSkillSchema,
  updateSettingsSchema,
} from "@agentos/shared";
import { describe, expect, it } from "vitest";
import { CloudPublisher } from "../src/runner/cloud-publisher";
import type { EnvironmentPolicy } from "../src/runner/runner.types";

/**
 * The rules that hold before anything runs: what a runtime object is named, and
 * what a configuration file is allowed to say. Both are places where a review
 * found the same mistake — a check that existed in one door but not the other.
 */
describe("contracts and publishing", () => {
  /**
   * A runtime environment is identified by its policy, not by the operator's
   * name for it. Two projects with a `production` environment are two walls.
   */
  it("publishes a separate runtime environment per project and per policy", async () => {
    const created: string[] = [];
    const api = {
      environments: {
        // eslint-disable-next-line require-yield
        async *list() {},
        async create(body: { name: string }) {
          created.push(body.name);
          return { id: `env_${created.length}`, name: body.name };
        },
      },
    };
    const publisher = new CloudPublisher();
    const policy = (projectId: string, allowedHosts: string[]): EnvironmentPolicy => ({
      projectId,
      key: "production",
      networking: "limited",
      allowedHosts,
    });

    await publisher.ensureEnvironment(api as never, policy("11111111-aaaa", ["api.one.com"]));
    await publisher.ensureEnvironment(api as never, policy("22222222-bbbb", ["api.two.com"]));
    // Same project, widened allowlist: a new environment, not the old one.
    await publisher.ensureEnvironment(api as never, policy("11111111-aaaa", ["api.one.com", "x"]));
    // Same policy again, order changed: the same wall, so no new environment.
    await publisher.ensureEnvironment(api as never, policy("11111111-aaaa", ["x", "api.one.com"]));

    expect(created).toHaveLength(3);
    expect(new Set(created).size).toBe(3);
  });

  /**
   * YAML is a second door into the same database. Both doors have to enforce
   * the same invariants or `agentos push` becomes the way around them.
   */
  it("holds YAML to the same mount-path and file-skill rules as the API", () => {
    expect(
      documentRepoSchema.safeParse({
        remoteUrl: "https://github.com/acme/app.git",
        mountPath: "/../../tmp/x",
      }).success,
    ).toBe(false);
    expect(
      documentSkillSchema.safeParse({ name: "runbook", kind: "file", filePath: null }).success,
    ).toBe(false);
    expect(
      documentSkillSchema.safeParse({ name: "runbook", kind: "file", filePath: "/skills/r.md" })
        .success,
    ).toBe(true);
  });

  /** A mount path is joined onto a workspace directory by the local runner. */
  it("refuses a repo mount path that climbs out of the workspace", () => {
    const base = {
      name: "app",
      remoteUrl: "https://github.com/acme/app.git",
      credentialSecretId: null,
      defaultBranch: "main",
    };
    expect(createRepoSchema.safeParse({ ...base, mountPath: "/repo" }).success).toBe(true);
    expect(createRepoSchema.safeParse({ ...base, mountPath: "/../../tmp/x" }).success).toBe(false);
    expect(createRepoSchema.safeParse({ ...base, mountPath: "/a/../../b" }).success).toBe(false);
  });
  it("refuses a timeout short enough to reap a question mid-read", async () => {
    expect(
      updateSettingsSchema.safeParse({
        parkedSessionTimeoutMinutes: 5,
        orphanSweepEnabled: true,
        orphanSweepIntervalMinutes: 15,
      }).success,
    ).toBe(false);

    // 0 is the documented way to disable it, so it has to stay legal.
    expect(
      updateSettingsSchema.safeParse({
        parkedSessionTimeoutMinutes: 0,
        orphanSweepEnabled: true,
        orphanSweepIntervalMinutes: 15,
      }).success,
    ).toBe(true);
  });

});
