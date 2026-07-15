import { NextRequest } from "next/server";
import { eq, or, and, asc, isNull, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { messagesTable, usersTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse } from "@/lib/api";

interface Sender {
  id: string;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  profile_photo_url: string | null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const me = await requireAuth(req);
    const { userId } = await params;

    const rows = await db.select().from(messagesTable)
      .where(or(
        and(eq(messagesTable.sender_id, me.id), eq(messagesTable.recipient_id, userId)),
        and(eq(messagesTable.sender_id, userId), eq(messagesTable.recipient_id, me.id)),
      ))
      .orderBy(asc(messagesTable.created_at));

    // Mark unread messages sent to me from this user as read
    await db.update(messagesTable)
      .set({ read_at: new Date() })
      .where(and(
        eq(messagesTable.sender_id, userId),
        eq(messagesTable.recipient_id, me.id),
        isNull(messagesTable.read_at),
      ));

    // Collect the set of distinct sender ids so we can render their avatars
    // in the thread (previously the thread never joined sender info, so
    // per-bubble avatars always showed a "?" letter).
    const senderIds = Array.from(new Set(rows.map((m) => m.sender_id)));
    const senders = senderIds.length > 0
      ? await db
          .select({
            id: usersTable.id,
            first_name: usersTable.first_name,
            last_name: usersTable.last_name,
            role: usersTable.role,
            profile_photo_url: usersTable.profile_photo_url,
          })
          .from(usersTable)
          .where(inArray(usersTable.id, senderIds))
      : [];
    const senderById = new Map<string, Sender>(senders.map((s) => [s.id, s]));

    const data = rows.map((m) => ({
      id: m.id,
      sender_id: m.sender_id,
      recipient_id: m.recipient_id,
      booking_id: m.booking_id ?? null,
      message_text: m.message_text,
      message_type: m.message_type ?? "text",
      read_at: m.read_at?.toISOString() ?? null,
      created_at: m.created_at?.toISOString() ?? null,
      sender: senderById.get(m.sender_id) ?? null,
    }));

    return jsonResponse(data);
  } catch (err) {
    return handleError(err, req);
  }
}