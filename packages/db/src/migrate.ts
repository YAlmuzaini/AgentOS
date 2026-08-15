import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase, requireDatabaseUrl } from "./client";

async function main(): Promise<void> {
  const db = createDatabase({ url: requireDatabaseUrl(), max: 1 });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../migrations") });
  console.log("migrations applied");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
