import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GithubAppService, type InstallationSummary } from "../src/github/github-app.service";
import { GithubService } from "../src/github/github.service";
import { ManifestResolver } from "../src/runner/manifest";
import { CatalogService } from "../src/resources/catalog.service";
import { createHarness, type Harness } from "./harness";

/**
 * Connecting a project to GitHub (SPEC §4 Repo, §5.1, §5.8).
 *
 * The setup callback is the interesting surface: GitHub redirects a browser to
 * it, so it carries no operator token and every query parameter is
 * attacker-suppliable. Two things stand between that and a bound installation —
 * the single-use state, and asking GitHub whether the installation is really
 * ours. Coolify shipped the second as a security fix after the fact; these
 * tests are here so it cannot be removed quietly.
 */
class StubGithubApp {
  installations = new Map<string, InstallationSummary>();
  tokens: string[] = [];
  forgotten: string[] = [];

  configured(): boolean {
    return true;
  }
  get slug(): string {
    return "agentos-test";
  }
  get htmlUrl(): string {
    return "https://github.com";
  }
  async describeInstallation(id: string): Promise<InstallationSummary | null> {
    return this.installations.get(id) ?? null;
  }
  async installationToken(id: string): Promise<string> {
    this.tokens.push(id);
    return `ghs_token_for_${id}`;
  }
  repositories: Array<{
    fullName: string;
    cloneUrl: string;
    defaultBranch: string;
    private: boolean;
  }> = [
    {
      fullName: "almuzaini/app",
      cloneUrl: "https://github.com/almuzaini/app.git",
      defaultBranch: "main",
      private: true,
    },
  ];

  async listRepositories() {
    return this.repositories;
  }
  forget(id: string): void {
    this.forgotten.push(id);
  }
}

describe("connecting GitHub", () => {
  let harness: Harness;
  let github: GithubService;
  let catalog: CatalogService;
  let stub: StubGithubApp;

  beforeAll(async () => {
    stub = new StubGithubApp();
    harness = await createHarness({
      override: (builder) => builder.overrideProvider(GithubAppService).useValue(stub),
    });
    github = harness.app.get(GithubService);
    catalog = harness.app.get(CatalogService);
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.reset();
    stub.installations.clear();
    stub.tokens = [];
    stub.forgotten = [];
    stub.repositories = [
      {
        fullName: "almuzaini/app",
        cloneUrl: "https://github.com/almuzaini/app.git",
        defaultBranch: "main",
        private: true,
      },
    ];
  });

  async function connect(projectId: string, installationId = "4242"): Promise<string> {
    stub.installations.set(installationId, {
      installationId,
      accountLogin: "almuzaini",
      accountType: "User",
      repositorySelection: "selected",
    });
    const { url } = await github.installUrl(projectId);
    const state = new URL(url).searchParams.get("state")!;
    await github.completeInstall({ installationId, state, setupAction: "install" });
    const status = await github.status(projectId);
    return status.installations[0]!.id;
  }

  it("binds an installation the operator started and GitHub confirmed", async () => {
    const { projectId } = await harness.seedProject();
    const id = await connect(projectId);

    const status = await github.status(projectId);
    expect(status.installations).toHaveLength(1);
    expect(status.installations[0]).toMatchObject({
      id,
      installationId: "4242",
      accountLogin: "almuzaini",
      repositorySelection: "selected",
    });
  });

  it("refuses a callback whose state was never issued", async () => {
    await harness.seedProject();
    stub.installations.set("4242", {
      installationId: "4242",
      accountLogin: "attacker",
      accountType: "User",
      repositorySelection: "all",
    });

    await expect(
      github.completeInstall({ installationId: "4242", state: "forged", setupAction: "install" }),
    ).rejects.toThrow(/did not match a connection started here/);
  });

  it("refuses a replayed state", async () => {
    const { projectId } = await harness.seedProject();
    stub.installations.set("4242", {
      installationId: "4242",
      accountLogin: "almuzaini",
      accountType: "User",
      repositorySelection: "all",
    });
    const { url } = await github.installUrl(projectId);
    const state = new URL(url).searchParams.get("state")!;

    await github.completeInstall({ installationId: "4242", state, setupAction: "install" });
    await expect(
      github.completeInstall({ installationId: "9999", state, setupAction: "install" }),
    ).rejects.toThrow(/did not match a connection started here/);
  });

  it("refuses an installation GitHub will not vouch for", async () => {
    const { projectId } = await harness.seedProject();
    const { url } = await github.installUrl(projectId);
    const state = new URL(url).searchParams.get("state")!;

    // The id is a claim until GitHub confirms it belongs to this App.
    await expect(
      github.completeInstall({ installationId: "1234567", state, setupAction: "install" }),
    ).rejects.toThrow(/could not confirm/);
    expect((await github.status(projectId)).installations).toHaveLength(0);
  });

  it("mints a clone token for a repo bound to an installation", async () => {
    const { projectId } = await harness.seedProject();
    const installationId = await connect(projectId);

    const repo = await catalog.createRepo(projectId, {
      name: "app",
      remoteUrl: "https://github.com/almuzaini/app.git",
      mountPath: "/workspace/app",
      githubInstallationId: installationId,
      credentialSecretId: null,
      defaultBranch: "main",
    });
    expect(repo.githubInstallationId).toBe(installationId);

    const row = await harness.db.query.repos.findFirst();
    expect(await github.cloneToken(row!)).toBe("ghs_token_for_4242");
  });

  it("will not let a repo borrow another project's installation", async () => {
    const { projectId } = await harness.seedProject();
    const installationId = await connect(projectId);

    const [other] = await harness.db.execute<{ id: string }>(
      sql`INSERT INTO projects (name, slug) VALUES ('Other', 'other') RETURNING id`,
    );

    await expect(
      catalog.createRepo(other!.id, {
        name: "app",
        remoteUrl: "https://github.com/almuzaini/app.git",
        mountPath: "/workspace/app",
        githubInstallationId: installationId,
        credentialSecretId: null,
        defaultBranch: "main",
      }),
    ).rejects.toThrow(/not found in this project/);
  });

  /**
   * The finding that blocked the first review: nothing bound `remoteUrl` to the
   * installation, so a repo could pair a real installation with any URL and the
   * next session would post a live token — good for every repository that
   * installation covers — to that host.
   */
  it("refuses a remote the installation does not cover", async () => {
    const { projectId } = await harness.seedProject();
    const installationId = await connect(projectId);

    await expect(
      catalog.createRepo(projectId, {
        name: "exfil",
        remoteUrl: "https://attacker.example/almuzaini/app.git",
        mountPath: "/workspace/app",
        githubInstallationId: installationId,
        credentialSecretId: null,
        defaultBranch: "main",
      }),
    ).rejects.toThrow(/does not cover/);
  });

  it("refuses a repository on the right host that was never granted", async () => {
    const { projectId } = await harness.seedProject();
    const installationId = await connect(projectId);

    await expect(
      catalog.createRepo(projectId, {
        name: "ungranted",
        remoteUrl: "https://github.com/someone-else/private.git",
        mountPath: "/workspace/app",
        githubInstallationId: installationId,
        credentialSecretId: null,
        defaultBranch: "main",
      }),
    ).rejects.toThrow(/does not cover/);
  });

  /**
   * `agentos push` is a second door: it upserts a repo by name and can rewrite
   * `remoteUrl` on a row whose installation stays put, which the create-time
   * check above never sees. So the clone path refuses a foreign host on its own.
   */
  it("mints nothing for a repo whose remote was later pointed off GitHub", async () => {
    const { projectId } = await harness.seedProject();
    const installationId = await connect(projectId);
    await catalog.createRepo(projectId, {
      name: "app",
      remoteUrl: "https://github.com/almuzaini/app.git",
      mountPath: "/workspace/app",
      githubInstallationId: installationId,
      credentialSecretId: null,
      defaultBranch: "main",
    });

    await harness.db.execute(
      sql`UPDATE repos SET remote_url = 'https://attacker.example/almuzaini/app.git'`,
    );
    const row = await harness.db.query.repos.findFirst();
    const resolver = harness.app.get(ManifestResolver);
    const granted = await resolver["repoToken"](row!);

    expect(granted).toBeNull();
    expect(stub.tokens).not.toContain("4242");
  });

  /**
   * The second review's finding: a host-only check passed `http://github.com`,
   * and git then sent the installation token over plaintext to whatever
   * answered on port 80.
   */
  it("mints nothing for a plaintext remote on the right host", async () => {
    const { projectId } = await harness.seedProject();
    const installationId = await connect(projectId);
    await catalog.createRepo(projectId, {
      name: "app",
      remoteUrl: "https://github.com/almuzaini/app.git",
      mountPath: "/workspace/app",
      githubInstallationId: installationId,
      credentialSecretId: null,
      defaultBranch: "main",
    });

    await harness.db.execute(
      sql`UPDATE repos SET remote_url = 'http://github.com/almuzaini/app.git'`,
    );
    const row = await harness.db.query.repos.findFirst();
    const resolver = harness.app.get(ManifestResolver);

    expect(await resolver["repoToken"](row!)).toBeNull();
    expect(stub.tokens).not.toContain("4242");
  });

  it("refuses to bind an http remote at the door as well", async () => {
    const { projectId } = await harness.seedProject();
    const installationId = await connect(projectId);

    await expect(
      catalog.createRepo(projectId, {
        name: "plaintext",
        remoteUrl: "http://github.com/almuzaini/app.git",
        mountPath: "/workspace/app",
        githubInstallationId: installationId,
        credentialSecretId: null,
        defaultBranch: "main",
      }),
    ).rejects.toThrow(/does not cover/);
  });

  /**
   * A repo bound to an installation must never quietly fall back to a stored
   * PAT: a GitHub outage would otherwise swap an hour-long, repo-scoped
   * credential for a long-lived account-wide one, unattended.
   */
  it("does not fall back to a personal access token when minting fails", async () => {
    const { projectId } = await harness.seedProject();
    const installationId = await connect(projectId);
    await catalog.createRepo(projectId, {
      name: "app",
      remoteUrl: "https://github.com/almuzaini/app.git",
      mountPath: "/workspace/app",
      githubInstallationId: installationId,
      credentialSecretId: null,
      defaultBranch: "main",
    });
    // The installation disappears, as it would after being uninstalled.
    await harness.db.execute(sql`DELETE FROM github_installations`);

    const row = await harness.db.query.repos.findFirst();
    const resolver = harness.app.get(ManifestResolver);
    expect(await resolver["repoToken"](row!)).toBeNull();
  });

  it("disconnecting drops the row and forgets the cached token", async () => {
    const { projectId } = await harness.seedProject();
    const installationId = await connect(projectId);

    await github.remove(projectId, installationId);

    expect((await github.status(projectId)).installations).toHaveLength(0);
    expect(stub.forgotten).toContain("4242");
  });

  it("keeps one project's installations out of another's status", async () => {
    const { projectId } = await harness.seedProject();
    await connect(projectId);
    const [other] = await harness.db.execute<{ id: string }>(
      sql`INSERT INTO projects (name, slug) VALUES ('Other', 'other') RETURNING id`,
    );

    expect((await github.status(other!.id)).installations).toHaveLength(0);
  });
});
