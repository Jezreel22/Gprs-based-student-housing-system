import { db } from "@/lib/db";
import { notificationsTable } from "@/lib/db/schema";
import { log } from "@/lib/log";

/**
 * Best-effort notification writer. A failed insert must never break the
 * parent action (a payment or message send shouldn't 500 because the
 * notifications table hiccuped), so errors are swallowed and logged.
 *
 * `type` is a free-form string — convention used in the app:
 *   "message"         — incoming message (relatedId = message id, relatedType = "message")
 *   "login"           — account sign-in (no relatedId)
 *   "escrow_release"  — escrow released to landlord (relatedId = booking id)
 *   "system"          — admin/system-level note
 */
export type NotificationType =
  | "message"
  | "login"
  | "escrow_release"
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