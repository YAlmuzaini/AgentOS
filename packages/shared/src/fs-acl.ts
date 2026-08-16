import type { FilesystemGrant } from "./contracts/agent";

/**
 * Server-side authorisation for the agent filesystem (SPEC §7).
 *
 * A pure function on purpose: the same rule is used by the tool handler, the
 * operator API, and the tests, so there is exactly one place where "may this
 * agent do this to this path" is decided. There is no client-side variant, and
 * agents never receive raw object-storage credentials that could bypass it.
 */

export type FsOperation = "list" | "read" | "write" | "mkdir" | "delete";

export interface FsDecision {
  allowed: boolean;
  reason: string;
  /** The normalised path the caller should act on. */
  path: string;
}

/**
 * Every agent gets a home folder it can read and write, but not delete.
 *
 * Returns null for a slug that would not name a single folder. An empty slug
 * would otherwise produce `/agents/`, handing that agent read and write over
 * every other agent's home; a slug containing a separator would silently point
 * somewhere else. Both are impossible through the API today — this is the wall
 * that keeps them impossible if a future caller stops validating.
 */
export function agentHomeFolder(agentSlug: string): string | null {
  if (agentSlug.trim() === "" || agentSlug.includes("/") || agentSlug.includes("\0")) {
    return null;
  }
  return `/agents/${agentSlug}/`;
}

/**
 * The folder every agent working one goal shares (SPEC §7, §11).
 *
 * Read and write, never delete: the point of a shared folder is that the next
 * specialist finds what the last one left, and a goal that can delete its own
 * history is a goal that can quietly undo itself. Returns null for anything
 * that is not a plain id, so a crafted goal id cannot widen the grant.
 */
export function goalFolder(goalId: string): string | null {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(goalId)) {
    return null;
  }
  return `/goals/${goalId}/`;
}

/** The grant a goal session carries in addition to its agent's own. */
export function goalFolderGrant(goalId: string | null): FilesystemGrant[] {
  const folder = goalId ? goalFolder(goalId) : null;
  return folder ? [{ folderPath: folder, canRead: true, canWrite: true, canDelete: false }] : [];
}

/**
 * Read grants for the files attached to the task a session is working.
 *
 * Exact paths, read only. An attachment is the previous step's output, and the
 * step that inherits it must be able to open it — but that is a grant on those
 * files, not on the folder they happen to live in.
 */
export function attachmentGrants(paths: string[]): FilesystemGrant[] {
  return paths
    .map((path) => normalisePath(path))
    .filter((path): path is string => path !== null && !path.endsWith("/"))
    .map((folderPath) => ({
      folderPath,
      canRead: true,
      canWrite: false,
      canDelete: false,
      // This file, not the tree beneath its name.
      exact: true,
    }));
}

export function normalisePath(input: string): string | null {
  if (!input.startsWith("/") || input.includes("\0")) {
    return null;
  }
  const segments: string[] = [];
  for (const segment of input.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      // Traversal is rejected outright rather than resolved: a grant check on
      // a resolved path would still let a caller probe the shape of the tree.
      return null;
    }
    segments.push(segment);
  }
  const trailing = input.endsWith("/") && segments.length > 0 ? "/" : "";
  return `/${segments.join("/")}${trailing}`;
}

function isWithin(folder: string, target: string): boolean {
  const prefix = folder.endsWith("/") ? folder : `${folder}/`;
  // `/agents/plan` and `/agents/plan/` are the same folder. Comparing only the
  // slashed forms denied an agent a listing of its own home.
  return target === folder || target === prefix || `${target}/` === prefix || target.startsWith(prefix);
}

function permits(grant: FilesystemGrant, operation: FsOperation): boolean {
  switch (operation) {
    case "list":
    case "read":
      return grant.canRead;
    case "write":
    case "mkdir":
      return grant.canWrite;
    case "delete":
      return grant.canDelete;
  }
}

export function authorizeFs(input: {
  agentSlug: string;
  grants: FilesystemGrant[];
  operation: FsOperation;
  path: string;
}): FsDecision {
  const path = normalisePath(input.path);
  if (path === null) {
    return { allowed: false, reason: "path is not an absolute, traversal-free path", path: input.path };
  }

  const home = agentHomeFolder(input.agentSlug);
  const effective: FilesystemGrant[] = [
    ...(home === null ? [] : [{ folderPath: home, canRead: true, canWrite: true, canDelete: false }]),
    ...input.grants,
  ];

  const matching = effective.filter((grant) => {
    const folder = normalisePath(grant.folderPath);
    if (folder === null) {
      return false;
    }
    // An exact grant is one path. Treating it as a prefix — which is what a
    // folder grant is — would let an attachment open everything named beneath
    // it.
    return grant.exact ? folder === path : isWithin(folder, path);
  });

  if (matching.length === 0) {
    return { allowed: false, reason: `no grant covers ${path}`, path };
  }

  // Any matching grant that permits the verb is enough — grants are additive,
  // and a narrower grant is how you widen access to a subfolder.
  if (matching.some((grant) => permits(grant, input.operation))) {
    return { allowed: true, reason: "granted", path };
  }

  return {
    allowed: false,
    reason: `grant on ${path} does not permit ${input.operation}`,
    path,
  };
}
