import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { ProvisionBody } from "./protocol.js";

/**
 * The throwaway directory one session works in.
 *
 * The cloud runner gets a fresh container per session; here the equivalent is a
 * fresh directory that is deleted on destroy. It is a weaker boundary and the
 * README says so: a session on this backend can read anything the worker's unix
 * user can read.
 */
export interface Workspace {
  dir: string;
  destroy(): Promise<void>;
}

export async function createWorkspace(root: string, input: ProvisionBody): Promise<Workspace> {
  const dir = await mkdtemp(join(root, "session-"));

  for (const repo of input.repos) {
    await cloneRepo(dir, repo);
  }

  return {
    dir,
    async destroy() {
      // The clone carries a credential in its remote URL if one was supplied,
      // so this removal is part of the security story, not just tidiness.
      //
      // Retried, because `fs.rm` does not retry by default and a real run
      // proved why: the agent's own tooling was still writing under the
      // workspace as it was torn down, and `rmdir` failed with `ENOTEMPTY` on
      // a directory that had been empty a moment earlier. The session then
      // reported a destroy failure and left the whole workspace on disk.
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

async function cloneRepo(dir: string, repo: ProvisionBody["repos"][number]): Promise<void> {
  const target = await resolveInside(dir, repo.mountPath);
  const url = repo.token ? authenticatedUrl(repo.remoteUrl, repo.token) : repo.remoteUrl;
  await run("git", ["clone", "--depth", "1", "--branch", repo.branch, url, target]);

  // The token came in for this clone only. Rewriting the remote afterwards
  // keeps it out of `.git/config`, where the agent could simply read it.
  if (repo.token) {
    await run("git", ["-C", target, "remote", "set-url", "origin", repo.remoteUrl]);
  }
}

/**
 * Resolves a mount path inside the workspace, or refuses.
 *
 * Lexical checking is not enough. An earlier repo can contain a committed
 * symlink — `escape -> /etc` — and a later mount path of `/first/escape/x`
 * passes any string comparison while `git clone` happily follows the link out
 * of the workspace, writing somewhere the cleanup will never reach.
 *
 * So the parent is created and then resolved through the filesystem with
 * `realpath`, and *that* is compared against the workspace's own real path.
 * Symlinks are followed here, once, deliberately — which is the only way to
 * find out where the write would actually land.
 */
async function resolveInside(dir: string, mountPath: string): Promise<string> {
  const root = await realpath(dir);
  const target = resolve(root, mountPath.replace(/^\/+/, ""));
  await mkdir(dirname(target), { recursive: true });

  const realParent = await realpath(dirname(target));
  const inside = relative(root, realParent);
  if (inside.startsWith("..") || resolve(root, inside) !== realParent) {
    throw new Error(`mount path ${mountPath} resolves outside the session workspace`);
  }

  const leaf = resolve(realParent, target.slice(dirname(target).length + 1));
  // The parent being inside is not enough: an earlier repo can leave a symlink
  // *at* this exact destination, and the clone would follow it out.
  const existing = await lstat(leaf).catch(() => null);
  if (existing?.isSymbolicLink()) {
    throw new Error(`mount path ${mountPath} already exists as a symlink; refusing to clone into it`);
  }
  return leaf;
}

export interface CommitRecord {
  repo: string;
  sha: string;
  subject: string;
}

/**
 * What this session committed, read straight out of the checkouts (SPEC §6).
 *
 * Observed rather than attested: the clone is a directory on a machine the
 * operator owns, so the honest answer is `git log` rather than whatever the
 * agent says it did. Commits are those on `HEAD` that the cloned tip does not
 * have — a shallow clone still records `origin/<branch>`, which is exactly the
 * base to compare against.
 *
 * Best effort by design: a repo the agent deleted, or one it left in a state
 * git will not read, must not stop the session from ending.
 */
export async function collectCommits(
  dir: string,
  repos: ProvisionBody["repos"],
): Promise<CommitRecord[]> {
  const commits: CommitRecord[] = [];
  for (const repo of repos) {
    // A `git-read` grant cannot produce a commit anyone will ever see, so a
    // local commit in one is a scratch commit, not a result.
    if (repo.permissions !== "git-write") {
      continue;
    }
    const target = join(dir, repo.mountPath.replace(/^\/+/, ""));
    try {
      const out = await capture("git", [
        "-C",
        target,
        "log",
        "--no-color",
        "--format=%H%x09%s",
        `origin/${repo.branch}..HEAD`,
      ]);
      for (const line of out.split("\n")) {
        const [sha, subject] = line.split("\t");
        if (sha?.trim()) {
          commits.push({ repo: repo.name, sha: sha.trim(), subject: (subject ?? "").trim() });
        }
      }
    } catch (error) {
      console.error(`could not read commits in ${repo.name}: ${String(error)}`);
    }
  }
  return commits;
}

function authenticatedUrl(remoteUrl: string, token: string): string {
  try {
    const url = new URL(remoteUrl);
    url.username = "x-access-token";
    url.password = token;
    return url.toString();
  } catch {
    return remoteUrl;
  }
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      // Never echo the command: its arguments may hold a clone token.
      reject(new Error(`${command} failed with code ${code}: ${redact(stderr).slice(0, 400)}`));
    });
  });
}

/** Same as `run`, but the caller wants what the command printed. */
function capture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(`${command} failed with code ${code}: ${redact(stderr).slice(0, 400)}`));
    });
  });
}

/** Git likes to quote the URL it failed on, credential and all. */
function redact(text: string): string {
  return text.replace(/\/\/[^@\s]*@/g, "//<redacted>@");
}
