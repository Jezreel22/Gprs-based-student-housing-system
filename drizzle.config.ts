import dotenv from "dotenv";
// Load local secrets first (.env.local is Next.js's convention and where
// PAYSTACK_* / DATABASE_URL live), then any shared .env defaults.
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });
import type { Config } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set for drizzle-kit to operate");
}

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  strict: true,
  verbose: true,
} satisfies Config;
