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
    return folder !== null && isWithin(folder, path);
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
