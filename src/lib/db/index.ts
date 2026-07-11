import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { log } from "@/lib/log";

if (!process.env.DATABASE_URL) {
  // Don't throw at import-time in serverless contexts where the env may not
  // be set at module load — fail at first query instead. But do log loudly.
  log.warn("DATABASE_URL is not set; queries will fail until it is.");
}

const connectionString = process.env.DATABASE_URL ?? "postgres://localhost:5432/_unset";

// `prepare: false` keeps postgres-js compatible with Next.js dev mode
// where connection state can be hot-reloaded.
const client = postgres(connectionString, {
  prepare: false,
  max: 10,
  idle_timeout: 20,
});

export const db = drizzle(client, { schema });

export * from "./schema";