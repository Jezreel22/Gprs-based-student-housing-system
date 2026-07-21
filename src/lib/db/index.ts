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
//
// Resilience options:
// - `connect_timeout` caps each TCP connect at 10s. Without it, postgres-js
//   waits forever on an unreachable host and the route handler hangs until
//   the request times out, which manifests as the UI staying on the
//   "listings loading" state forever.
// - `max_lifetime` rotates connections every 30 minutes so a long-lived
//   idle socket that the pooler has silently dropped is replaced rather
//   than handed out as an `ECONNRESET`.
// - `keep_alive` keeps TCP sockets warm — without it, the very first query
//   after idle pays a fresh connect/DNS round-trip, and on flaky networks
//   (NAT64, intermittent egress) that round-trip can fail with
//   ETIMEDOUT/ENETUNREACH even though the database is fine.
// - `backoff` retries transient connect failures with exponential backoff so
//   a single dropped SYN doesn't poison the request — it gives a reachable
//   pooler a second chance instead of failing the query outright.
const client = postgres(connectionString, {
  prepare: false,
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  max_lifetime: 30 * 60, // 30 min — rotate stale sockets before the pooler drops them
  keep_alive: 30, // TCP keepalive every 30s so idle sockets stay warm
  backoff: true, // retry transient connect failures with exponential backoff
  onnotice: () => {},
});

// `connection` events fire when postgres-js opens a fresh socket to the
// pooler. Catching errors here lets us log the underlying network failure
// (ETIMEDOUT, ENETUNREACH, ECONNRESET) rather than letting it bubble up
// as an opaque "Failed query" that hides the real cause.
const clientAny = client as unknown as {
  on?(event: string, cb: (...args: unknown[]) => void): void;
};
if (typeof clientAny.on === "function") {
  clientAny.on("error", (err: unknown) => {
    const e = err as Error & { code?: string };
    log.error("db_connection_error", {
      message: e?.message,
      code: e?.code,
      // AggregateError from a failed connect carries the inner connect
      // failures — those are what actually tell us *why* the pooler was
      // unreachable.
      inner: (e as Error & { errors?: unknown[] }).errors?.map((x) =>
        x instanceof Error ? `${x.name}: ${x.message}` : String(x),
      ),
    });
  });
}

export const db = drizzle(client, { schema });

export * from "./schema";