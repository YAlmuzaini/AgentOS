import { z } from "zod";
import { CATEGORIES, type Category } from "../catalog/categories";
import { NETWORKING_MODES } from "../enums";
import { patchSchema } from "./patch";
import { slugSchema } from "./project";

/* ── Environments — the network wall (SPEC §5.5) ───────────────────────── */

export const createEnvironmentSchema = z.object({
  name: slugSchema,
  networking: z.enum(NETWORKING_MODES).default("limited"),
  /** Only meaningful when networking is `limited`. */
  allowedHosts: z.array(z.string().min(1)).default([]),
});
export type CreateEnvironmentInput = z.infer<typeof createEnvironmentSchema>;

export const updateEnvironmentSchema = patchSchema(createEnvironmentSchema).omit({ name: true });
export type UpdateEnvironmentInput = z.infer<typeof updateEnvironmentSchema>;

export interface EnvironmentDto {
  id: string;
  projectId: string;
  name: string;
  networking: (typeof NETWORKING_MODES)[number];
  allowedHosts: string[];
}

/* ── Secrets — references only, never values (SPEC §5.8) ───────────────── */

export const SECRET_PURPOSES = ["mcp", "repo", "env", "webhook"] as const;
export type SecretPurpose = (typeof SECRET_PURPOSES)[number];

export const createSecretRefSchema = z.object({
  name: slugSchema,
  /** Resolved by the configured provider — an env var name in dev. */
  providerRef: z.string().min(1),
  purpose: z.enum(SECRET_PURPOSES),
});
export type CreateSecretRefInput = z.infer<typeof createSecretRefSchema>;

export interface SecretRefDto {
  id: string;
  projectId: string;
  name: string;
  providerRef: string;
  purpose: SecretPurpose;
  /** Whether the provider can currently resolve it. Never the value itself. */
  resolvable: boolean;
}

/* ── MCP connections ───────────────────────────────────────────────────── */

/**
 * An MCP endpoint URL, refused if it carries the credential itself.
 *
 * AgentOS stores secrets as *references* and never as values (SPEC §5.8), and
 * a URL is neither — it is stored verbatim, returned by the API, and rendered
 * on a screen. `https://user:secret@host/mcp` and `?api_key=…` both walked
 * straight through `z.string().url()` and put a live credential in the
 * database, where the verifier's later refusal was far too late to matter.
 *
 * Userinfo is unambiguous and always refused. Query parameters are judged by
 * name, and only names that mean nothing else: the catalogue's own URLs carry
 * `tools`, `telemetry-enabled` and `exaApiKey`, and legitimate configuration
 * must keep working. A server that hides its key in a *path* segment cannot be
 * caught this way at all — that limitation is documented rather than pretended
 * away.
 */
/**
 * Words that make a parameter name a credential, wherever they appear in it.
 *
 * A fixed list of exact names was the wrong shape: it accepted `api-key`,
 * `client_secret`, `key`, and `exaApiKey` — every real spelling except the ones
 * that happened to be written down. Substring matching catches the family, and
 * the catalogue's own parameters (`tools`, `telemetry-enabled`) contain none of
 * these words, so legitimate configuration keeps working.
 */
const CREDENTIAL_WORDS: string[] = [
  "key",
  "token",
  "secret",
  "password",
  "passwd",
  "pwd",
  "credential",
  "signature",
];

/**
 * Names that are a credential in themselves, matched whole.
 *
 * `auth` alone is one; `authMode`, `author` and `authority` are not, and
 * substring matching rejected all four. Kept separate so the strong words
 * above can stay aggressive without taking ordinary configuration with them.
 */
const CREDENTIAL_EXACT: string[] = ["auth", "authorization", "sig"];

/**
 * Credential names written as one word, which tokenising cannot split.
 *
 * `apiKey` splits to `api` + `key`; `apikey` does not, and real APIs use both
 * spellings. Compared against the name with its separators removed, so
 * `api_key`, `api-key`, `apiKey` and `apikey` all land here.
 */
/**
 * Words that end a credential's name.
 *
 * Enumerating compounds — `apikey`, `clientsecret`, `accesstoken` — was a list
 * that could never be finished: `refreshtoken`, `idtoken` and `jwttoken` are
 * all real and none of them were on it. A **suffix** rule catches the family
 * instead, because these names are built the same way: something, then the
 * kind of credential it is.
 *
 * Suffix rather than substring is what keeps `keyspace` and `keyboardLayout`
 * usable — they *start* with the word, and a parameter named for what it holds
 * ends with it.
 */
const CREDENTIAL_SUFFIXES: string[] = [
  "key",
  "token",
  "secret",
  "password",
  "passwd",
  "pwd",
  "credential",
  "signature",
];

/**
 * Splits a parameter name into the words a human would read in it.
 *
 * `api-key` → `api`, `key`. `exaApiKey` → `exa`, `api`, `key`. `keyspace`
 * stays one word, which is why it is allowed: matching on *tokens* rather than
 * substrings is what tells a key from a keyspace.
 */
function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .map((word) => word.toLowerCase())
    .filter(Boolean);
}

export const mcpUrlSchema = z
  .string()
  .url()
  .refine((value) => !hasUrlCredential(value), {
    message:
      "put the credential in a secret reference rather than in the URL — a URL is stored and " +
      "displayed verbatim, so anything in it is a secret in the database",
  });

/**
 * Parsed by hand rather than with `URL`, because this module is shared with the
 * browser bundle and the CLI and carries no lib assumptions. The two shapes it
 * looks for are simple enough that a parser is not warranted.
 */
function hasUrlCredential(value: string): boolean {
  // Userinfo, judged by scheme. Over http(s) *any* userinfo is HTTP Basic —
  // `https://ghp_live_token@host/mcp` is a bearer credential with no colon in
  // sight — so all of it is refused. Over ssh a bare username is the
  // transport's user rather than anybody's secret, which is why
  // `ssh://git@host:2222/org/repo.git` has to keep working; a password there
  // is still refused.
  const parsed = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)@/.exec(value);
  if (parsed) {
    const scheme = parsed[1]!.toLowerCase();
    const userinfo = parsed[2]!;
    if (scheme === "http" || scheme === "https" || userinfo.includes(":")) {
      return true;
    }
  }

  // Query *and* fragment: `#access_token=…` is the OAuth implicit-flow shape,
  // and it reaches the database exactly like a query parameter does.
  const afterScheme = value.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
  const beforeFragment = afterScheme.split("#")[0]!;
  const parts = [beforeFragment.split("?")[1], afterScheme.split("#")[1]];

  for (const part of parts) {
    if (!part) {
      continue;
    }
    for (const pair of part.split("&")) {
      const raw = pair.split("=")[0] ?? "";
      // A malformed escape threw a `URIError` straight out of `safeParse`,
      // turning a validation question into an internal error. The raw name is
      // a perfectly good thing to match on when decoding is impossible.
      let name = raw;
      try {
        name = decodeURIComponent(raw);
      } catch {
        name = raw;
      }
      const lower = name.toLowerCase();
      const squashed = lower.replace(/[^a-z0-9]/g, "");
      const parts = words(name);
      if (
        CREDENTIAL_EXACT.includes(lower) ||
        CREDENTIAL_SUFFIXES.some((word) => squashed.endsWith(word)) ||
        parts.some((part) => CREDENTIAL_WORDS.includes(part))
      ) {
        return true;
      }
    }
  }
  return false;
}

export const createMcpConnectionSchema = z.object({
  name: slugSchema,
  url: mcpUrlSchema,
  allowedOperations: z.array(z.string().min(1)).default([]),
  credentialSecretId: z.string().uuid().nullable().default(null),
});
export type CreateMcpConnectionInput = z.infer<typeof createMcpConnectionSchema>;

/**
 * Editing a connection after it exists.
 *
 * `name` is deliberately absent. It is the key `agentos.yml` and the built-in
 * installer reconcile on, and it is what a session's manifest calls the server;
 * renaming through this door would orphan the YAML entry and silently change
 * what an agent's prompt says it holds. Delete and recreate instead.
 *
 * Everything here is a partial: sending `{ credentialSecretId }` alone attaches
 * a credential without touching a carefully narrowed URL, which is the common
 * case straight after installing a built-in. `patchSchema` rather than
 * `.partial()` is what makes that sentence true — see its own comment.
 */
export const updateMcpConnectionSchema = patchSchema(createMcpConnectionSchema).omit({
  name: true,
});
export type UpdateMcpConnectionInput = z.infer<typeof updateMcpConnectionSchema>;

export interface McpConnectionDto {
  id: string;
  projectId: string;
  name: string;
  url: string;
  allowedOperations: string[];
  credentialSecretId: string | null;
  /** ISO timestamp of the last successful handshake, or null if never checked. */
  verifiedAt: string | null;
  /** Tool names the server reported. Names only — never schemas or values. */
  verifiedTools: string[];
  /** Why the last check failed. Credential-free by construction. */
  verifyError: string | null;
}

/* ── Repos ─────────────────────────────────────────────────────────────── */

/**
 * Where a repo is mounted inside a session.
 *
 * Absolute and traversal-free. A leading slash alone is not enough: the local
 * runner joins this onto its throwaway workspace directory, so `/../../tmp/x`
 * would clone outside the workspace and survive its cleanup.
 */
export const mountPathSchema = z
  .string()
  .startsWith("/")
  .refine((value) => !value.split("/").includes(".."), {
    message: "must not contain a `..` segment",
  })
  .refine((value) => !value.includes("\0"), { message: "must not contain a NUL byte" });

export const createRepoSchema = z.object({
  name: slugSchema,
  // The same rule as an MCP endpoint, for the same reason: `remoteUrl` is
  // stored verbatim and returned by `RepoDto`, so a credential in it is a
  // credential in the database and on the screen. The GitHub App check does
  // not close this — `normaliseRemote()` drops userinfo before comparing, so a
  // credential-bearing URL still matches its installation.
  remoteUrl: mcpUrlSchema,
  mountPath: mountPathSchema,
  /**
   * How a session authenticates the clone. A GitHub App installation is the
   * better of the two — the token it mints expires in an hour and reaches only
   * the repositories the operator selected — so it wins when both are set.
   */
  githubInstallationId: z.string().uuid().nullable().default(null),
  credentialSecretId: z.string().uuid().nullable().default(null),
  defaultBranch: z.string().min(1).default("main"),
});
export type CreateRepoInput = z.infer<typeof createRepoSchema>;

export interface RepoDto {
  id: string;
  projectId: string;
  name: string;
  remoteUrl: string;
  mountPath: string;
  githubInstallationId: string | null;
  credentialSecretId: string | null;
  defaultBranch: string;
}

/* ── Skills ────────────────────────────────────────────────────────────── */

export const SKILL_KINDS = ["prompt", "file"] as const;

export const createSkillSchema = z
  .object({
    name: z.string().min(1).max(200),
    slug: slugSchema,
    /** What it does and when it applies. Shown wherever a skill is granted. */
    description: z.string().max(1024).default(""),
    category: z.enum(CATEGORIES).default("general"),
    kind: z.enum(SKILL_KINDS).default("prompt"),
    body: z.string().default(""),
    filePath: z.string().nullable().default(null),
  })
  .refine((value) => (value.kind === "prompt" ? value.body.length > 0 : Boolean(value.filePath)), {
    message: "a prompt skill needs a body; a file skill needs a filePath",
  });
export type CreateSkillInput = z.infer<typeof createSkillSchema>;

export interface SkillDto {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  description: string;
  category: Category;
  kind: (typeof SKILL_KINDS)[number];
  body: string;
  filePath: string | null;
}

/* ── Environment variable bindings ─────────────────────────────────────── */

export const createEnvBindingSchema = z.object({
  /** Which environment gets this variable. Sessions outside it never see it. */
  environmentId: z.string().uuid(),
  key: z
    .string()
    .min(1)
    .regex(/^[A-Z][A-Z0-9_]*$/, "must be SCREAMING_SNAKE_CASE"),
  secretId: z.string().uuid(),
  allowedHosts: z.array(z.string().min(1)).default([]),
});
export type CreateEnvBindingInput = z.infer<typeof createEnvBindingSchema>;

export interface EnvBindingDto {
  id: string;
  projectId: string;
  /** Null only for rows written before bindings were environment-scoped. */
  environmentId: string | null;
  key: string;
  secretId: string;
  allowedHosts: string[];
}

/* ── Agent filesystem ──────────────────────────────────────────────────── */

export interface FileEntryDto {
  path: string;
  kind: "file" | "folder";
  size: number;
  mime: string;
  updatedAt: string | null;
  /**
   * For a folder: how many files are under it, at any depth.
   *
   * A browser that shows a folder and nothing else leaves the operator to
   * click it to find out whether it holds anything — and on this disk most
   * folders belong to an agent that may never have written a thing.
   */
  childCount?: number;
}

export const writeFileSchema = z.object({
  path: z.string().startsWith("/"),
  content: z.string(),
  mime: z.string().default("text/plain"),
});
export type WriteFileInput = z.infer<typeof writeFileSchema>;
