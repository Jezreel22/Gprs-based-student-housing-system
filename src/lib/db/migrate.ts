import "../load-env";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { log } from "../log";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run migrations");
  }
  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  const db = drizzle(client);

  log.info("Running migrations from ./drizzle");
  await migrate(db, { migrationsFolder: "./drizzle" });
  log.info("Migrations complete.");

  await client.end();
}

main().catch((err) => {
  log.error("Migration failed", { err });
  process.exit(1);
});