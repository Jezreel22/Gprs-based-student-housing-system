import dotenv from "dotenv";
// Load local secrets first (.env.local is Next.js's convention and where
// PAYSTACK_* / DATABASE_URL live), then any shared .env defaults.
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });
import type { Config } from "drizzle-kit";

// drizzle-kit needs a session-level connection to introspect the schema. The
// app's DATABASE_URL points at the transaction pooler (port 5432), which can't
// run drizzle's introspection — so prefer the session pooler (port 6543) here.
// See DRIZZLE_DATABASE_URL in .env.local.
const url = process.env.DRIZZLE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL (or DRIZZLE_DATABASE_URL) must be set for drizzle-kit to operate");
}

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
} satisfies Config;
