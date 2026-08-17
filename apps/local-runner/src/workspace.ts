import { spawn } from "node:child_process";
import type { Dirent } from "node:fs";
import { lstat, mkdir, mkdtemp, readdir, realpath, rm, utimes, writeFile } from "node:fs/promises";
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
/**
 * A repository cloned with no commits in it yet.
 *
 * Distinct from "no base recorded": an empty repository legitimately has no
 * `HEAD`, and the agent's first commit is real work that must be pushed. The
 * sentinel says "everything here is new" rather than "we could not tell".
 */
export const EMPTY_REPO = "";

/**
 * One canonical form for a mount path.
 *
 * `/app`, `/app/`, `/a//app` and `/a/./app` are the same directory and were
 * three different map keys — so a legal mount missed its trusted base and fell
 * back to a ref the agent can rewrite, which is the whole hole again.
 */
export function mountKey(mountPath: string): string {
  return mountPath
    .split("/")
    .filter((segment) => segment && segment !== ".")
    .join("/");
}

export interface Workspace {
  dir: string;
  /**
   * The commit each granted repository was cloned at, by mount path.
   *
   * Held by the worker, in memory, because the alternative is asking the
   * checkout — and `refs/remotes/origin/main` is a file the agent can write.
   * An agent that committed and then ran `git update-ref refs/remotes/origin/main
   * HEAD` made its own work look already-pushed, and teardown deleted it. This
   * is the one record of the starting point that the session cannot edit.
   */
  baseShas: Map<string, string>;
  destroy(): Promise<void>;
}

export async function createWorkspace(root: string, input: ProvisionBody): Promise<Workspace> {
  const dir = await mkdtemp(join(root, "session-"));

  const baseShas = new Map<string, string>();
  try {
    for (const repo of input.repos) {
      await cloneRepo(dir, repo);
      // Read immediately after the clone, before the agent exists.
      const target = join(dir, repo.mountPath.replace(/^\/+/, ""));

      // A clone that succeeded but whose HEAD cannot be read is either an
      // empty repository — legitimate, and the agent's first commit is real
      // work — or something pathological. Shrugging at the second means
      // publishing falls back to `origin/<branch>`, which the agent can
      // rewrite, so the two are told apart rather than lumped together.
      const base = (
        await capture("git", ["-C", target, "rev-parse", "HEAD"]).catch(() => "")
      ).trim();
      if (base) {
        baseShas.set(mountKey(repo.mountPath), base);
        continue;
      }
      const empty = await capture("git", ["-C", target, "rev-list", "--count", "--all"])
        .then((out) => out.trim() === "0")
        .catch(() => false);
      if (!empty) {
        throw new Error(`could not read the base commit of ${repo.name} after cloning it`);
      }
      baseShas.set(mountKey(repo.mountPath), EMPTY_REPO);
    }
  } catch (error) {
    // A half-built workspace is not the caller's to clean up, and leaving it
    // means a retried provision accumulates checkouts until the next restart.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  return {
    dir,
    baseShas,
    async destroy() {
      // The checkout holds no credential — the clone keeps the token in the
      // git child's environment and writes nothing authenticated into
      // `.git/config` — but it does hold the agent's work and whatever it
      // fetched, so removal is still the boundary.
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

/**
 * Clones a granted repository without the credential ever being written down.
 *
 * The token used to be embedded in the clone URL. Two things were wrong with
 * that and neither needed an attacker: the URL is an argument, so the token was
 * visible in `ps` to every process on the machine for the duration of the
 * clone, and git wrote the authenticated remote into `.git/config`, where it
 * sat until a second command replaced it — so a worker killed in between left a
 * checkout with a live credential in it on disk.
 *
 * It now travels the same way it does on the way out: in the git child's own
 * environment, read back by an inline credential helper. The helper text is in
 * argv and contains only the name of a variable. Nothing is left in
 * `.git/config` to rewrite afterwards.
 */
async function cloneRepo(dir: string, repo: ProvisionBody["repos"][number]): Promise<void> {
  const target = await resolveInside(dir, repo.mountPath);
  await run(
    "git",
    [
      ...(repo.token ? credentialHelperArgs() : []),
      "clone",
      "--depth",
      "1",
      "--branch",
      repo.branch,
      repo.remoteUrl,
      target,
    ],
    repo.token ? { AGENTOS_GIT_TOKEN: repo.token } : undefined,
  );
}

/**
 * Hands git a credential through the environment rather than the command line.
 *
 * The empty helper first clears whatever the machine has configured globally,
 * so a developer's keychain cannot answer instead of us.
 */
function credentialHelperArgs(): string[] {
  return [
    "-c",
    "credential.helper=",
    "-c",
    `credential.helper=!f() { echo username=x-access-token; echo "password=$AGENTOS_GIT_TOKEN"; }; f`,
  ];
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
  /** Clone-time shas, by mount path. Trusted; the checkout's refs are not. */
  baseShas: Map<string, string> = new Map(),
  /** Applied to commit subjects, which are agent-authored free text. */
  scrub: (text: string) => string = (text) => text,
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
      // Against the clone-time sha where we have it. Reading `origin/<branch>`
      // let an agent that moved that ref record *no* commits while the push
      // still moved the remote — a session row that understated what happened.
      const recorded = baseShas.get(mountKey(repo.mountPath));
      // `EMPTY_REPO` is a known-empty clone: everything in it is new work, and
      // `--all` counts it without a base to subtract.
      const base = recorded === undefined ? `origin/${repo.branch}` : recorded;

      // One snapshot, like publish. Reading live `HEAD` twice — once to list
      // and once to push — lets a surviving subprocess move it in between, so
      // the shas recorded here would describe a different commit set from the
      // one that was published.
      const head = (await capture("git", ["-C", target, "rev-parse", "HEAD"])).trim();
      const out = await capture("git", [
        "-C",
        target,
        "log",
        "--no-color",
        "--format=%H%x09%s",
        ...(base === EMPTY_REPO ? [head] : [`${base}..${head}`]),
      ]);
      for (const line of out.split("\n")) {
        const [sha, subject] = line.split("\t");
        if (sha?.trim()) {
          commits.push({
            repo: repo.name,
            sha: sha.trim(),
            // A commit message is written by the agent and can quote anything
            // it was granted. The control plane stores only the sha, but this
            // still crosses the worker's HTTP boundary.
            subject: scrub((subject ?? "").trim()),
          });
        }
      }
    } catch (error) {
      console.error(`could not read commits in ${repo.name}: ${String(error)}`);
    }
  }
  return commits;
}

/**
 * True when a directory contains any git checkout at all.
 *
 * The boot sweep's rule, and deliberately cruder than the in-session one. The
 * worker's memory is gone after a restart, so there is no trust source for
 * what the remote actually has — and the checkout's own refs are files the
 * agent could have rewritten. Asking git anyway would produce a confident
 * answer built on a mutable input, and a wrong "already pushed" deletes the
 * only copy. So a leftover workspace with a repository in it is kept, full
 * stop; one with no repository is deleted. The disk cost is bounded by
 * `LOCAL_RUNNER_QUARANTINE_DAYS`.
 */
export async function containsCheckout(dir: string): Promise<boolean> {
  try {
    return (await findCheckouts(dir)).length > 0;
  } catch {
    // Unreadable, too deep, or too large to search: assume there is something
    // to lose.
    return true;
  }
}

/**
 * True when a directory holds a git checkout with commits the remote lacks.
 *
 * Used by the boot sweep to tell "leftover junk" from "the only copy of an
 * afternoon's work". Deliberately cheap and deliberately pessimistic: anything
 * it cannot read is reported as holding work, because deleting on a failed
 * `git log` is exactly the mistake worth not making.
 */
export async function holdsUnpushedWork(
  dir: string,
  /**
   * Clone-time shas by mount path, when the caller has them.
   *
   * Without them this can only ask the checkout, and the checkout's remote
   * refs are files the agent can write — so an absent map means "cannot
   * establish what the remote has", and every caller in that position treats
   * the answer as "assume there is work".
   */
  baseShas?: Map<string, string>,
): Promise<boolean> {
  let checkouts: string[];
  try {
    checkouts = await findCheckouts(dir);
  } catch {
    // Cannot look — unreadable, too deep, or too large to search. Assume there
    // is something to lose: deleting on a question we could not answer is
    // exactly the mistake worth not making.
    return true;
  }
  for (const checkout of checkouts) {
    // A trusted base for this checkout, matched by the mount path it sits at.
    const relative = mountKey(checkout.slice(dir.length));
    const trustedBase = baseShas?.get(relative);
    try {
      // `HEAD` is named explicitly: `--all` walks refs, and a detached HEAD is
      // not a ref. An agent that checked out a sha and committed on top of it
      // would otherwise look like a clean checkout and be deleted.
      // `HEAD --all --not <base>`, not `base..HEAD`. An agent that commits on
      // `feature` and then checks the base back out leaves work that is
      // unreachable from `HEAD` but perfectly real — and the narrow question
      // answered zero, so teardown deleted it. Asking about every ref keeps it.
      const ahead =
        trustedBase !== undefined && trustedBase !== EMPTY_REPO
        ? await capture("git", [
            "-C",
            checkout,
            "rev-list",
            "--count",
            "HEAD",
            "--all",
            "--not",
            trustedBase,
          ])
        : trustedBase === EMPTY_REPO
        ? await capture("git", ["-C", checkout, "rev-list", "--count", "HEAD", "--all"])
        : await capture("git", [
            "-C",
            checkout,
            "rev-list",
            "--count",
            "HEAD",
            "--all",
            "--not",
            "--remotes",
          ]);
      if ((Number.parseInt(ahead.trim(), 10) || 0) > 0) {
        return true;
      }
    } catch {
      // A repository git will not read is one we cannot clear as safe.
      return true;
    }
  }
  return false;
}

/**
 * Every git checkout under a workspace.
 *
 * Looking only at immediate children missed the ordinary case of a nested
 * mount — `/services/api` puts `.git` two levels down, so the repository was
 * invisible and its unpushed commits were deleted.
 *
 * The limits are budgets, not silent cut-offs, and the difference is the whole
 * point. A depth cap that simply stopped searching answered "no work here" for
 * a repository mounted at `/a/b/c/d/e`, which is a legal mount path — a wrong
 * answer that deletes commits. Exceeding either budget now **throws**, and the
 * caller treats an unanswerable question as "assume there is work", so the
 * failure mode is a retained directory rather than a lost afternoon.
 *
 * The entry budget also bounds the walk itself: an agent that created hundreds
 * of thousands of directories should not turn teardown into a memory problem
 * while the control plane holds the request open.
 */
async function findCheckouts(dir: string, budget = { entries: 50_000 }, depth = 0): Promise<string[]> {
  if (depth > 12) {
    throw new Error(`${dir} is nested deeper than this can search`);
  }
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    throw new Error(`could not read ${dir}`);
  }

  budget.entries -= entries.length;
  if (budget.entries < 0) {
    throw new Error("the workspace holds more entries than this can search");
  }

  // A checkout announces itself with `.git`, which is a directory in the
  // ordinary case and a *file* for a worktree or a submodule — one line saying
  // `gitdir: ../elsewhere`. Only matching the directory form left a fully
  // functional checkout invisible, and teardown deleted its commits.
  if (entries.some((entry) => entry.name === ".git")) {
    return [dir];
  }

  const found: string[] = [];
  for (const entry of entries) {
    // Symlinks are never followed: a link is not where a repository lives, and
    // following one is how a walk finds a loop or leaves the workspace.
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      continue;
    }
    // Directories that cannot contain a mounted repository, and are the ones
    // most likely to be enormous.
    if (entry.name === "node_modules" || entry.name === ".venv") {
      continue;
    }
    found.push(...(await findCheckouts(join(dir, entry.name), budget, depth + 1)));
  }
  return found;
}

/**
 * File a quarantined workspace carries, holding the moment it was set aside.
 *
 * The retention clock cannot come from the directory's `mtime`: a rename leaves
 * that untouched, so a workspace from an old session looked instantly expired.
 */
export const QUARANTINE_MARKER = ".agentos-quarantined-at";

/**
 * Starts the retention clock on a workspace that has just been set aside.
 *
 * Belt and braces, because the failure mode is deleting recoverable work. The
 * marker file is the readable record; `utimes` makes the directory's own mtime
 * agree with it, so the expiry's fallback is *correct* rather than merely
 * available. Previously the marker write could fail — a full disk, a name
 * already taken by a directory — and the fallback then read the age of the
 * dead session and expired the workspace on the next boot.
 *
 * If both fail, the expiry treats the directory as un-aged and keeps it, which
 * is the right way round.
 */
export async function stampQuarantine(dir: string): Promise<boolean> {
  const now = new Date();
  const marked = await writeFile(join(dir, QUARANTINE_MARKER), now.toISOString(), "utf8")
    .then(() => true)
    .catch((error: unknown) => {
      console.error(`could not mark ${dir} as quarantined: ${String(error)}`);
      return false;
    });
  const touched = await utimes(dir, now, now)
    .then(() => true)
    .catch(() => false);
  if (!marked && !touched) {
    // Nothing recorded the moment this was set aside, so nothing can date it.
    // The sweep keeps such a directory forever rather than guessing from an
    // mtime that belongs to the dead session — which would have expired
    // recoverable work on the very next boot.
    console.error(
      `${dir}: could not record when it was quarantined; it will be kept until removed by hand`,
    );
  }
  return marked || touched;
}

export interface PublishRecord {
  repo: string;
  branch: string;
  pushed: boolean;
  /** The sha now on the remote branch, when the push succeeded. */
  remoteSha: string | null;
  /** How many local commits were ahead of the clone's tip. */
  commits: number;
  /** Populated when `pushed` is false and it was not simply a no-op. */
  error: string | null;
}

/**
 * Pushes what the session committed, using a credential the agent never had.
 *
 * This is the difference between a local coding session being useful and being
 * theatre. The agent commits into a throwaway directory; without this the
 * directory is deleted and the commits go with it.
 *
 * Four rules make it safe to do here rather than in the agent:
 *
 * 1. **The destination is the granted remote, never the workspace's own.** The
 *    agent has a shell and can `git remote set-url origin https://attacker/x`.
 *    Reading the destination from the clone would turn "push the work" into an
 *    exfiltration primitive, so the URL comes from the provision body — the
 *    thing the operator actually granted — and `origin` is ignored entirely.
 * 2. **`git-write` only.** A read-only grant that produced commits produced
 *    scratch commits; pushing them would manufacture write access out of a
 *    read grant.
 * 3. **Fast-forward only.** No force, no lease, no branch creation off a
 *    detached head. If the remote moved, the push fails and the workspace is
 *    kept rather than the remote being overwritten.
 * 4. **The token never lands anywhere durable.** It is passed to the git child
 *    through its environment and read back by an inline credential helper, so
 *    it is absent from argv (visible in `ps` to every process on this machine),
 *    from `.git/config`, and from any error text git prints.
 */
export async function publishCommits(
  dir: string,
  repos: ProvisionBody["repos"],
  /** Clone-time shas, by mount path. Trusted; the checkout's refs are not. */
  baseShas: Map<string, string> = new Map(),
): Promise<PublishRecord[]> {
  const records: PublishRecord[] = [];

  for (const repo of repos) {
    if (repo.permissions !== "git-write") {
      continue;
    }
    const record: PublishRecord = {
      repo: repo.name,
      branch: repo.branch,
      pushed: false,
      remoteSha: null,
      commits: 0,
      error: null,
    };
    records.push(record);

    const target = join(dir, repo.mountPath.replace(/^\/+/, ""));
    try {
      if (!repo.token) {
        // Provisioning already refuses a credential-less repo, so this is a
        // belt-and-braces guard rather than an expected path.
        throw new Error("no credential was supplied for this repository");
      }
      // The rule being enforced is "a credential never crosses the network in
      // plaintext". `https` satisfies it; `file` satisfies it by not being a
      // network at all, and the destination cannot be attacker-chosen because
      // it comes from the operator's grant rather than from the clone. Anything
      // else — `http`, `git`, `ssh` — either sends the token in the clear or
      // cannot carry it, so it is refused rather than attempted.
      if (!/^(https|file):/i.test(repo.remoteUrl)) {
        throw new Error(
          `${repo.remoteUrl} is not an https remote, and an installation token is HTTP Basic auth`,
        );
      }

      // Counted against the sha we cloned at, not against `origin/<branch>` —
      // that ref lives in the checkout and the agent can move it. Falling back
      // to the ref only when no base was recorded, which is the boot-sweep
      // case where the worker's memory is gone.
      const recorded = baseShas.get(mountKey(repo.mountPath));
      // `EMPTY_REPO` is a known-empty clone: everything in it is new work.
      // `undefined` is different — no base was recorded, so the only thing
      // left to compare against is the checkout's own ref.
      const base = recorded === undefined ? `origin/${repo.branch}` : recorded;

      // One snapshot for the whole operation. Counting against `HEAD`, then
      // resolving `HEAD` again to push, asks the same question twice of a
      // moving target: a surviving subprocess that resets `HEAD` back to the
      // base between the two reads gets the base pushed, recorded as a commit,
      // and installed as the new base — after which the work it reset away
      // looks published and is deleted.
      const pushing = (await capture("git", ["-C", target, "rev-parse", "HEAD"])).trim();
      if (!pushing) {
        throw new Error("could not resolve HEAD");
      }

      const ahead = (
        await capture(
          "git",
          base === EMPTY_REPO
            ? ["-C", target, "rev-list", "--count", pushing]
            : ["-C", target, "rev-list", "--count", `${base}..${pushing}`],
        )
      ).trim();
      record.commits = Number.parseInt(ahead, 10) || 0;
      if (record.commits === 0) {
        // Nothing to publish is a success, and saying so keeps a no-op session
        // from reading as a failed push.
        record.pushed = true;
        record.remoteSha = base === EMPTY_REPO ? null : (await capture("git", ["-C", target, "rev-parse", base])).trim();
        continue;
      }

      // Refuse anything that is not a straight continuation of what we cloned.
      // A rewritten history would need a force push, and this never forces.
      if (base !== EMPTY_REPO) {
        await capture("git", ["-C", target, "merge-base", "--is-ancestor", base, pushing]);
      }

      // The rule is "never create a branch that was not granted", and the
      // precise test for that is whether the destination already exists on the
      // remote — not whether the local HEAD happens to be attached.
      //
      // Refusing every detached HEAD was too blunt and broke a legitimate
      // flow: an agent that detaches to bisect, commits a fix, and finishes is
      // still pushing a fast-forward to the branch it was granted. What must
      // be refused is the case a *tag* produces — `--branch v1.0` detaches,
      // and `HEAD:refs/heads/v1.0` would invent a branch of that name.
      const onBranch = (
        await capture("git", ["-C", target, "symbolic-ref", "--quiet", "--short", "HEAD"]).catch(
          () => "",
        )
      ).trim();
      if (!onBranch) {
        // The credential has to reach this child too. Without it a private
        // repository answers "authentication failed", which `catch` turned
        // into "the branch does not exist" — refusing a legitimate push and
        // reporting the wrong reason.
        const listed = await capture(
          "git",
          [
            "-C",
            target,
            ...credentialHelperArgs(),
            "ls-remote",
            "--heads",
            repo.remoteUrl,
            `refs/heads/${repo.branch}`,
          ],
          { AGENTOS_GIT_TOKEN: repo.token },
        ).catch((error: unknown) => {
          // Could not ask. Fail closed — refusing to push is recoverable,
          // inventing a branch on someone's remote is not — but say which it
          // was, rather than claiming the branch is absent.
          throw new Error(
            `HEAD is detached and the remote could not be asked whether ${repo.branch} exists: ` +
              redact(String(error), repo.token),
          );
        });
        if (!listed.trim()) {
          throw new Error(
            `HEAD is detached and ${repo.branch} is not a branch on the remote — pushing would ` +
              "create a branch that was never granted",
          );
        }
      }

      await pushWithToken(target, repo.remoteUrl, repo.branch, repo.token, pushing);

      record.remoteSha = pushing;
      record.pushed = true;

      // The push went to a URL rather than to the named remote, so git did not
      // move `origin/<branch>` itself. Moving it here keeps the checkout an
      // honest record of what the remote now has — which is what the boot
      // sweep reads when deciding whether a leftover workspace still holds
      // work nobody else has. Best effort: the push already succeeded, and
      // failing to update a local ref must not turn that into a reported
      // failure.
      await run("git", [
        "-C",
        target,
        "update-ref",
        `refs/remotes/origin/${repo.branch}`,
        pushing,
      ]).catch(() => {});

      // And the trusted base moves with it. Leaving it at the clone-time sha
      // meant `base..HEAD` stayed positive forever, so every session that
      // actually produced something was quarantined instead of cleaned up —
      // a disk leak proportional to how well the product works.
      baseShas.set(mountKey(repo.mountPath), pushing);
    } catch (error) {
      record.error = redact(String(error), repo.token).slice(0, 400);
    }
  }

  return records;
}

/**
 * `git push <granted-url> HEAD:refs/heads/<branch>`, with the credential
 * arriving through the environment rather than the command line.
 *
 * The helper is a shell function git invokes and reads two lines from. Its
 * text appears in argv, which is why the text contains no secret — only the
 * name of an environment variable that this child, and nothing else, holds.
 */
function pushWithToken(
  target: string,
  remoteUrl: string,
  branch: string,
  token: string,
  /** The exact commit to publish. Named, so it cannot move under the push. */
  sha: string,
): Promise<void> {
  return run(
    "git",
    ["-C", target, ...credentialHelperArgs(), "push", remoteUrl, `${sha}:refs/heads/${branch}`],
    { AGENTOS_GIT_TOKEN: token },
  );
}


/**
 * @param extraEnv merged over this process's environment for the child only.
 *   Used to hand git a credential without putting it in argv, where every
 *   process on the machine could read it out of `ps`.
 */
/**
 * A ceiling on any one git invocation.
 *
 * A push to an unreachable host hangs on the network, and this runs inside
 * teardown — so without a timeout a stalled push holds the session open past
 * the worker's own hard limit, which is the one thing that limit exists to
 * prevent.
 */
const GIT_TIMEOUT_MS = 120_000;

function run(
  command: string,
  args: string[],
  extraEnv?: Record<string, string>,
): Promise<void> {
  const token = extraEnv?.AGENTOS_GIT_TOKEN ?? null;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      timeout: GIT_TIMEOUT_MS,
      killSignal: "SIGKILL",
      stdio: ["ignore", "ignore", "pipe"],
      ...(extraEnv
        ? {
            env: {
              ...process.env,
              ...extraEnv,
              // Never let git stop to ask a human: this runs unattended, and a
              // prompt would hang the teardown until the session timed out.
              GIT_TERMINAL_PROMPT: "0",
            },
          }
        : {}),
    });
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
      // Never echo the command: its arguments may hold a clone token. And
      // scrub before slicing — a token longer than the cap would otherwise
      // leave its prefix behind.
      reject(new Error(`${command} failed with code ${code}: ${redact(stderr, token).slice(0, 400)}`));
    });
  });
}

/** Same as `run`, but the caller wants what the command printed. */
function capture(
  command: string,
  args: string[],
  extraEnv?: Record<string, string>,
): Promise<string> {
  const token = extraEnv?.AGENTOS_GIT_TOKEN ?? null;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GIT_TIMEOUT_MS,
      killSignal: "SIGKILL",
      ...(extraEnv
        ? { env: { ...process.env, ...extraEnv, GIT_TERMINAL_PROMPT: "0" } }
        : {}),
    });
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
      reject(
        new Error(`${command} failed with code ${code}: ${redact(stderr, token).slice(0, 400)}`),
      );
    });
  });
}

/**
 * Removes the credential from anything git printed.
 *
 * Two shapes, because there are two ways it gets in. Git quotes the URL it
 * failed on, credential and all — that is the `//user:token@host` form. And a
 * git *server* can decode the HTTP Basic header and echo the token back in its
 * response body, which git prints to stderr verbatim; URL-shaped redaction
 * never sees that one, and it ended up in a session row.
 *
 * The caller passes the token so the literal can be removed at any length.
 * Scrubbing happens before any truncation: slicing first cuts a long token in
 * half and leaves the front of it in the database.
 */
function redact(text: string, token?: string | null): string {
  let safe = text.replace(/\/\/[^@\s]*@/g, "//<redacted>@");
  if (token) {
    safe = safe.split(token).join("<redacted>");
    // The Basic header itself, in case git echoed the encoded form.
    const encoded = Buffer.from(`x-access-token:${token}`).toString("base64");
    safe = safe.split(encoded).join("<redacted>");
  }
  return safe;
}
