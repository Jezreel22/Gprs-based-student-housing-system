import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { notificationsTable, usersTable } from "@/lib/db/schema";
import { log } from "@/lib/log";

/**
 * Best-effort notification writer. A failed insert must never break the
 * parent action (a payment or message send shouldn't 500 because the
 * notifications table hiccuped), so errors are swallowed and logged.
 *
 * `type` is a free-form string — convention used in the app:
 *   "message"         — incoming message (relatedId = message id, relatedType = "message")
 *   "login"           — account sign-in (no relatedId)
 *   "escrow_funded"   — funds landed in escrow; fired once per booking (relatedId = booking id)
 *   "escrow_release"  — escrow released to landlord (relatedId = booking id)
 *   "payment"         — payment-confirmed reminder to the student (relatedId = booking id)
 *   "system"          — admin/system-level note
 */
export type NotificationType =
  | "message"
  | "login"
  | "escrow_release"
  | "escrow_funded"
  | "payment"
  | "system";

export async function createNotification(args: {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  relatedId?: string | null;
  relatedType?: string | null;
}): Promise<void> {
  try {
    await db.insert(notificationsTable).values({
      user_id: args.userId,
      type: args.type,
      title: args.title,
      body: args.body ?? null,
      related_id: args.relatedId ?? null,
      related_type: args.relatedType ?? null,
    });
  } catch (err) {
    log.warn("notification_write_failed", {
      userId: args.userId,
      type: args.type,
      error: (err as Error)?.message,
    });
  }
}

/**
 * All escrow-officer user ids. Called rarely (once per escrow-funded event) and
 * there's typically a single platform officer, so no caching. Best-effort: a
 * query failure returns an empty list (the landlord/student fan-out still runs).
 */
export async function getEscrowOfficers(): Promise<string[]> {
  try {
    const rows = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.role, "escrow_officer"));
    return rows.map((r) => r.id);
  } catch (err) {
    log.warn("officer_lookup_failed", { error: (err as Error)?.message });
    return [];
  }
}

function formatNGN(n?: number | null): string {
  if (!n) return "₦0";
  return `₦${n.toLocaleString("en-NG")}`;
}

/**
 * Fan-out the "funds just landed in escrow" notifications: the landlord learns
 * their dashboard now has a share-the-code CTA, the student gets a move-in
 * reminder, and every officer gets visibility that money is being held.
 *
 * Best-effort — `createNotification` swallows insert errors, and the whole
 * fan-out is awaited but never throws, so it can't break the paid-state flip
 * that triggers it. Callers gate it on the paid transition so it fires exactly
 * once per booking.
 */
export async function notifyEscrowFunded(args: {
  bookingId: string;
  landlordId: string;
  studentId: string;
  totalAmountNgn?: number | null;
  propertyAddress?: string | null;
}): Promise<void> {
  const amount = formatNGN(args.totalAmountNgn);
  const where = args.propertyAddress ? ` for ${args.propertyAddress}` : "";

  const officers = await getEscrowOfficers();

  await Promise.all([
    createNotification({
      userId: args.landlordId,
      type: "escrow_funded",
      title: "Funds held in escrow",
      body: `${amount} is held in escrow${where}. Share the occupancy code with your tenant so they can confirm move-in.`,
      relatedId: args.bookingId,
      relatedType: "booking",
    }),
    createNotification({
      userId: args.studentId,
      type: "payment",
      title: "Payment received",
      body: "Your funds are held in escrow. Enter the occupancy code your landlord gives you to confirm move-in.",
      relatedId: args.bookingId,
      relatedType: "booking",
    }),
    ...officers.map((officerId) =>
      createNotification({
        userId: officerId,
        type: "escrow_funded",
        title: "Escrow funded",
        body: `${amount} held in escrow${where}. Awaiting occupancy confirmation.`,
        relatedId: args.bookingId,
        relatedType: "booking",
      }),
    ),
  ]);
}