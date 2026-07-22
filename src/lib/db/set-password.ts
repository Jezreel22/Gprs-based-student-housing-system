import "../load-env";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "./index";
import { usersTable } from "./schema";
import { log } from "../log";

/**
 * Set a fresh password for any seeded demo account so the user can use
 * credentials they're comfortable with. The seed always re-creates the same
 * three accounts with the same emails (`admin@naub.local`, `landlord@naub.local`,
 * `student@naub.local`) — this script is the easy way to override the
 * default `passw0rd` without re-seeding.
 *
 * Usage:  npx tsx src/lib/db/set-password.ts <email> <new-password>
 * Example: npx tsx src/lib/db/set-password.ts admin@naub.local mySecret123
 *
 * Idempotent — re-running just updates the password again.
 */

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run set-password");
  }
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error("Usage: npx tsx src/lib/db/set-password.ts <email> <new-password>");
    process.exit(2);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(2);
  }

  const [user] = await db
    .select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (!user) {
    console.error(`No user with email ${email}. Run \`npm run db:seed\` first.`);
    process.exit(2);
  }

  const password_hash = await bcrypt.hash(password, 10);
  await db
    .update(usersTable)
    .set({ password_hash, updated_at: new Date() })
    .where(eq(usersTable.id, user.id));

  console.log(`Password updated for ${email} (role: ${user.role}).`);
  log.info("db:set-password updated", { email, role: user.role });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error("db:set-password failed", { err });
    process.exit(1);
  });