# Migrations

## Workflow

This project uses **hand-written SQL migrations** applied directly, not `drizzle-kit generate` / `db:push` / `db:migrate`.

### Why

drizzle-kit's introspection is incompatible with this project's Supabase DB. The
issues are independent of the pooler:

- **CHECK constraint parser crash.** `drizzle-kit@0.31.10`'s introspection query
  joins `information_schema.table_constraints` to `pg_constraint` and on this
  Supabase DB the join returns rows with `constraint_definition = NULL`, so
  the parser throws `TypeError: Cannot read properties of undefined (reading
  'replace')`. Reproduces on the session pooler (port 6543).

- **Transaction pooler hangs introspection.** `db:push` on the project's main
  pooler URL (port 5432, transaction mode) hangs indefinitely at "Pulling
  schema from database". Switching to the session pooler (port 6543) avoids
  the hang but still hits the CHECK crash above.

- **`db:migrate` fails with permissions.** drizzle's migrator tries
  `CREATE SCHEMA "drizzle"` for its bookkeeping, which the app role can't do.

So neither drizzle-kit nor its migrator works against this DB.

### How to add a migration

1. **Write the SQL** — drop a new file in this directory, e.g. `0003_my_feature.sql`.
   Follow the `--> statement-breakpoint` format used by existing files and use
   `IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`
   so re-runs are safe. (Drizzle's `--> statement-breakpoint` markers are
   stripped by `db:apply`; the file runs as one simple query.)

2. **Apply it:**
   ```bash
   npm run db:apply 0003_my_feature.sql
   ```

3. **List pending migrations:**
   ```bash
   npm run db:apply
   ```

### Generated files

- `0000_add_uploads_table.sql` — original generated entry (sole journal entry).
- `0001_trust_event_expiry.sql` — trust event expiry fields.
- `0002_property_ratings.sql` — property ratings table.
- `0003_ratings_rating_type_check.sql` — restricts `ratings.rating_type`.

The journal (`meta/_journal.json`) and snapshot (`meta/0000_snapshot.json`)
reflect the state at project creation. Do **not** run `db:generate` — it will
produce a broken migration that tries to `CREATE` tables that already exist in
the live DB.

### Connection modes (for the curious)

- **`DATABASE_URL` (port 5432, transaction pooler)** — used by the app at
  runtime. Fast, IPv4-reachable, but can't host DDL/long queries.
- **`DRIZZLE_DATABASE_URL` (port 6543, session pooler)** — same host,
  session mode. *Defined for tooling even though drizzle-kit doesn't end up
  working.* Use this if you ever wire up a different schema-diff tool.
- **Direct (`db.<ref>.supabase.co:5432`)** — IPv6-only, unreachable from this
  network. The comment in `.env.local` warns about this.

`DRIZZLE_DATABASE_URL` is read by `drizzle.config.ts` for tooling that does
honour session mode (e.g. `psql`, custom scripts). It is **not** used by the
app, and should **not** be set in Vercel.
