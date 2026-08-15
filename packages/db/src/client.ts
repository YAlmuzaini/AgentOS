import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDatabase>;

export interface DatabaseOptions {
  url: string;
  /** Migrations and one-shot scripts want a single connection. */
  max?: number;
}

export function createDatabase(options: DatabaseOptions) {
  const client = postgres(options.url, { max: options.max ?? 10 });
  return drizzle(client, { schema });
}

/**
 * Fail loud when a required secret is unset in production (RECIPE A2).
 */
export function requireDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set — refusing to start without a database");
  }
  return url;
}
