import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Secrets are read from env only and never persisted (RECIPE A2). A missing
 * required secret fails startup loudly rather than degrading at runtime.
 */
/** A URL that may carry a credential, so plaintext is refused outright. */
const httpsUrl = z
  .string()
  .url()
  .refine((value) => value.toLowerCase().startsWith("https://"), {
    message: "must be an https:// URL — credentials are sent to it",
  });

const envSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(3001),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  AGENTOS_OPERATOR_TOKEN: z
    .string()
    .min(32, "AGENTOS_OPERATOR_TOKEN must be at least 32 chars"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_WORKSPACE: z.string().default("default"),

  // Object storage for the agent filesystem (MinIO locally, R2 in production).
  S3_ENDPOINT: z.string().default("http://localhost:9000"),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().default("agentos"),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),

  /** Public origin used to build inbound webhook URLs. */
  PUBLIC_URL: z.string().default("http://localhost:3001"),

  /**
   * Master secret that per-trigger webhook signing keys are derived from.
   * Falls back to the operator token so a fresh install works; set it
   * explicitly in production so rotating one does not rotate the other.
   */
  WEBHOOK_MASTER_SECRET: z.string().default(""),

  // Web Push (VAPID). Push is skipped when these are unset.
  VAPID_PUBLIC_KEY: z.string().default(""),
  VAPID_PRIVATE_KEY: z.string().default(""),
  VAPID_SUBJECT: z.string().default("mailto:operator@localhost"),

  /**
   * Which secret backend resolves a `providerRef` (SPEC §4, §23).
   *
   * `env` reads the process environment and is the development driver.
   * `gcp` reads Google Secret Manager, where the value is encrypted at rest
   * and the app database holds only the resource name.
   */
  SECRETS_PROVIDER: z.enum(["env", "gcp"]).default("env"),
  /** Default GCP project for a bare secret name; full resource paths win. */
  GCP_PROJECT_ID: z.string().default(""),

  /**
   * GitHub App, so a repo needs no personal access token (SPEC §4 Repo).
   *
   * A PAT is a long-lived credential with the union of every scope its owner
   * ticked; a GitHub App mints an *installation token* that expires in an hour
   * and reaches only the repositories the operator selected on github.com.
   * That is strictly better for a system whose whole premise is handing
   * credentials to a model.
   *
   * The App is created once by hand on github.com and its private key lives in
   * the secret store like every other credential — the manifest flow would have
   * AgentOS *generate* and persist a private key, and there is no write path
   * into Secret Manager here. `GITHUB_APP_PRIVATE_KEY` is a providerRef, so
   * under `SECRETS_PROVIDER=gcp` it names a Secret Manager resource rather than
   * holding a PEM.
   */
  GITHUB_APP_ID: z.string().default(""),
  GITHUB_APP_SLUG: z.string().default(""),
  GITHUB_APP_PRIVATE_KEY: z.string().default(""),
  /**
   * GitHub Enterprise Server installs point these at their own host.
   *
   * **https, enforced at startup.** `GITHUB_HTML_URL` is the origin every clone
   * credential is checked against, so a value that does not parse would make
   * that check compare against nothing. And `GITHUB_API_URL` is where an
   * `Authorization: Bearer` header carrying the App JWT and every minted
   * installation token is sent — an `http://` value there puts live credentials
   * on the wire in the clear, which is the same failure as an http clone remote
   * and is not something a deployment should be able to configure by accident.
   */
  GITHUB_API_URL: httpsUrl.default("https://api.github.com"),
  GITHUB_HTML_URL: httpsUrl.default("https://github.com"),

  /** Local runner worker endpoint, used by the local backend when healthy. */
  LOCAL_RUNNER_URL: z.string().default(""),
  LOCAL_RUNNER_TOKEN: z.string().default(""),

  /**
   * Error reporting (RECIPE A8). Any Sentry-compatible DSN; GlitchTip is the
   * self-hosted one this is written for. Unset means errors stay in the log,
   * which is the default and leaks nothing off the machine.
   */
  GLITCHTIP_DSN: z.string().default(""),
  /** Tags reports so a staging stack does not look like production. */
  DEPLOY_ENV: z.string().default("development"),
  /** Optional build identifier, so a regression points at a deploy. */
  RELEASE: z.string().default(""),

  /** Tests drive the orchestrator directly; the queue worker stays off. */
  AGENTOS_DISABLE_WORKER: z
    .union([z.literal("1"), z.literal("0"), z.literal("true"), z.literal("false")])
    .optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

export const APP_CONFIG = Symbol("APP_CONFIG");

/**
 * Reads the repo-root .env in development. In production the process
 * environment is supplied by the platform (Coolify) and no file is present.
 */
function loadDotEnv(): void {
  const candidate = path.resolve(__dirname, "../../../../.env");
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  loadDotEnv();
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n  ");
    throw new Error(`Invalid environment:\n  ${detail}`);
  }
  return parsed.data;
}
