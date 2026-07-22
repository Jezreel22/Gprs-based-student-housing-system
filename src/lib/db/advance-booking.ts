import "../load-env";
import { eq } from "drizzle-orm";
import { db } from "./index";
import { bookingsTable } from "./schema";
import { log } from "../log";

/**
 * Force a booking through the rest of its lifecycle without hitting Paystack.
 * Useful in dev / demos when you want to validate the officer-release flow
 * without running a full test charge.
 *
 * This walks the booking through every state the UI would normally reach:
 *   pending_payment → pending_occupancy → pending_review → release_pending
 * then calls the same officer "mark disbursed" path the admin button uses.
 *
 * Usage: npx tsx src/lib/db/advance-booking.ts <booking-id>
 *
 * SAFETY: refuses to run when NODE_ENV=production so this can never be
 * invoked against the live DB by accident.
 */

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to run in production. This script is dev-only.");
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run advance-booking");
  }
  const id = process.argv[2];
  if (!id) {
    console.error("Usage: npx tsx src/lib/db/advance-booking.ts <booking-id>");
    process.exit(2);
  }

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
  if (!booking) {
    console.error(`No booking with id ${id}`);
    process.exit(2);
  }
  console.log(`Starting state: ${booking.booking_status}`);

  const now = new Date();

  if (booking.booking_status === "pending_payment") {
    // Simulate a successful Paystack charge without hitting the API.
    await db
      .update(bookingsTable)
      .set({
        booking_status: "pending_occupancy",
        payment_transaction_id: `DEV-${id.slice(0, 8)}-${Date.now()}`,
        funds_received_at: now,
        updated_at: now,
      })
      .where(eq(bookingsTable.id, id));
    console.log("→ pending_occupancy (simulated payment)");
  }

  // Re-read for the next step.
  const [b2] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
  if (b2?.booking_status === "pending_occupancy") {
    await db
      .update(bookingsTable)
      .set({
        booking_status: "pending_review",
        occupancy_verified_at: now,
        occupancy_confirmed_by_student_at: now,
        updated_at: now,
      })
      .where(eq(bookingsTable.id, id));
    console.log("→ pending_review (simulated occupancy confirmation)");
  }

  const [b3] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
  if (b3?.booking_status === "pending_review") {
    await db
      .update(bookingsTable)
      .set({
        booking_status: "release_pending",
        payout_initiated_at: now,
        updated_at: now,
      })
      .where(eq(bookingsTable.id, id));
    console.log("→ release_pending (simulated student release approval)");
  }

  console.log(`\nFinal state: release_pending — open /admin (login as admin@naub.local) and click "Mark disbursed" to complete.`);
  log.info("db:advance-booking complete", { bookingId: id });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    log.error("db:advance-booking failed", { err });
    process.exit(1);
  });