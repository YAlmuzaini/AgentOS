import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Secrets are read from env only and never persisted (RECIPE A2). A missing
 * required secret fails startup loudly rather than degrading at runtime.
 */
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

  /** Local runner worker endpoint, used by the local backend when healthy. */
  LOCAL_RUNNER_URL: z.string().default(""),
  LOCAL_RUNNER_TOKEN: z.string().default(""),

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
