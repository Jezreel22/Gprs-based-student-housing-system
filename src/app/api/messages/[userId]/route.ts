import { NextRequest } from "next/server";
import { eq, or, and, asc, sql, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { messagesTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse } from "@/lib/api";
import type { MessageItem } from "@/api/generated/api.schemas";

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

    const data: MessageItem[] = rows.map((m) => ({
      id: m.id,
      sender_id: m.sender_id,
      recipient_id: m.recipient_id,
      booking_id: m.booking_id ?? null,
      message_text: m.message_text,
      message_type: m.message_type ?? "text",
      read_at: m.read_at?.toISOString() ?? null,
      created_at: m.created_at?.toISOString() ?? null,
    }));

    void sql; // silence unused
    return jsonResponse(data);
  } catch (err) {
    return handleError(err, req);
  }
}