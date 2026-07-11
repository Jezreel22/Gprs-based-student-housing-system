import dotenv from "dotenv";

/**
 * Side-effect module: import this FIRST in any script that talks to the DB
 * (seed, migrate, drizzle scripts run outside Next.js, which would otherwise
 * load `.env.local` for us).
 *
 * It MUST be a side-effect import (not a plain call) so it runs during the
 * ESM import phase — before `./db/index` is evaluated and captures
 * `process.env.DATABASE_URL`. A bare `dotenv.config()` call in module body
 * would run AFTER imports (hoisting) and leave DATABASE_URL unset.
 *
 * `.env.local` is loaded first and wins (dotenv doesn't overwrite keys that
 * are already in `process.env`), then `.env` for shared defaults.
 */
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });
