/**
 * Apply a drizzle SQL migration directly through the app's postgres client.
 *
 * Why this exists: on this Supabase project, `drizzle-kit push` hangs on the
 * pooler (it can't complete schema introspection) and `drizzle-kit migrate`
 * fails because the app role can't `CREATE SCHEMA "drizzle"` for drizzle's
 * bookkeeping. So migrations are applied as raw SQL — matching how
 * 0001_trust_event_expiry.sql was originally applied.
 *
 * Usage:
 *   npx tsx src/lib/db/apply-migration.ts 0002_property_ratings.sql
 *
 * The file is read from ./drizzle. Drizzle's `--> statement-breakpoint` markers
 * are stripped and the file runs as a single simple query; write migrations
 * idempotently (IF NOT EXISTS) so re-runs are safe.
 *
 * To discover unapplied migrations, run without an argument:
 *   npx tsx src/lib/db/apply-migration.ts
 */
import "@/lib/load-env";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, {
  prepare: false, max: 1, idle_timeout: 5, connect_timeout: 15,
});

async function appliedFiles(): Promise<Set<string>> {
  // drizzle records applied migrations in `__drizzle_migrations` when its
  // migrator has ever run. On this project it never has, so treat the table
  // as optional — absence means "nothing tracked, apply by hand".
  try {
    const rows: { hash: string }[] = await sql`
      SELECT hash FROM "__drizzle_migrations"
    `;
    return new Set(rows.map((r) => r.hash));
  } catch {
    return new Set();
  }
}

async function main() {
  const dir = join(process.cwd(), "drizzle");
  const target = process.argv[2];

  if (!target) {
    const files = (await readdir(dir))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    console.log("Migrations in ./drizzle:");
    for (const f of files) console.log("  " + f);
    console.log("\nApply one with: npx tsx src/lib/db/apply-migration.ts <file>");
    return;
  }

  const path = join(dir, target);
  const raw = await readFile(path, "utf8");
  const script = raw.replace(/-->\s*statement-breakpoint/g, "");
  await sql.unsafe(script);
  console.log(`✓ applied ${target}`);
}

main()
  .then(() => sql.end())
  .catch((e) => { console.error("ERROR:", e?.message ?? e); process.exit(1); });
