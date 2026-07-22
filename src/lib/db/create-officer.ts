import "../load-env";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "./index";
import { usersTable } from "./schema";
import { log } from "../log";

/**
 * Provision an escrow officer account with credentials the owner controls.
 *
 * Escrow officers aren't a self-service signup role (only Student / Landlord
 * register through the UI) — they're created here so the owner can sign in to
 * the Admin panel and release payouts.
 *
 * Idempotent: if the email already exists, the existing row is promoted to
 * `escrow_officer` (if it wasn't already) and its password is reset.
 *
 * Usage:  npm run db:create-officer -- <email> <password> [firstName] [lastName]
 * Example: npm run db:create-officer -- you@example.com mySecret123 Jane Doe
 */

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run create-officer");
  }
  const [email, password, firstName, lastName] = process.argv.slice(2);
  if (!email || !password) {
    console.error("Usage: npm run db:create-officer -- <email> <password> [firstName] [lastName]");
    process.exit(2);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(2);
  }

  const password_hash = await bcrypt.hash(password, 10);

  const [existing] = await db
    .select({ id: usersTable.id, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (existing) {
    // Promote/reset rather than fail. Clobbering a non-officer account is
    // deliberate here — this is an owner-run provisioning tool, not user input.
    await db
      .update(usersTable)
      .set({
        role: "escrow_officer",
        password_hash,
        verification_status: "verified",
        first_name: firstName ?? undefined,
        last_name: lastName ?? undefined,
        account_suspended: false,
        updated_at: new Date(),
      })
      .where(eq(usersTable.id, existing.id));
    const promoted = existing.role !== "escrow_officer";
    console.log(
      `${promoted ? "Promoted" : "Reset"} ${email} to escrow_officer (password updated).`,
    );
    log.info("db:create-officer existing", { email, promotedFrom: existing.role });
    return;
  }

  const [created] = await db
    .insert(usersTable)
    .values({
      email,
      password_hash,
      role: "escrow_officer",
      first_name: firstName ?? null,
      last_name: lastName ?? null,
      verification_status: "verified",
    })
    .returning({ id: usersTable.id });

  console.log(`Created escrow officer ${email} (id: ${created.id}).`);
  log.info("db:create-officer created", { email, id: created.id });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error("db:create-officer failed", { err });
    process.exit(1);
  });
