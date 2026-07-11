import { NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, or, sql, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { messagesTable, usersTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse } from "@/lib/api";
import type { ConversationPreview } from "@/api/generated/api.schemas";

const SendMessageBody = z.object({
  recipient_id: z.string().uuid(),
  message_text: z.string().min(1).max(2000),
  booking_id: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const me = await requireAuth(req);

    // Build conversation previews: for each other user I've messaged or who messaged me,
    // return the most recent message and unread count.
    const rows = await db.execute(sql`
      SELECT
        CASE WHEN sender_id = ${me.id} THEN recipient_id ELSE sender_id END AS other_user_id,
        MAX(created_at) AS last_message_at,
        COUNT(*) FILTER (WHERE recipient_id = ${me.id} AND read_at IS NULL)::int AS unread_count
      FROM ${messagesTable}
      WHERE sender_id = ${me.id} OR recipient_id = ${me.id}
      GROUP BY 1
    `);

    const list = (rows as any).rows ?? rows;
    const otherIds = list.map((r: any) => r.other_user_id);
    const otherUsers = otherIds.length > 0
      ? await db.select().from(usersTable).where(inArray(usersTable.id, otherIds))
      : [];

    // For each conversation, fetch the last message in *that* conversation
    // (filtered to messages between me and the other user).
    const conversations: ConversationPreview[] = await Promise.all(list.map(async (r: any) => {
      const otherUser = (otherUsers as any[]).find((u) => u.id === r.other_user_id);
      const conv = await db.select({ message_text: messagesTable.message_text, created_at: messagesTable.created_at })
        .from(messagesTable)
        .where(or(
          and(eq(messagesTable.sender_id, me.id), eq(messagesTable.recipient_id, r.other_user_id)),
          and(eq(messagesTable.sender_id, r.other_user_id), eq(messagesTable.recipient_id, me.id)),
        ))
        .orderBy(desc(messagesTable.created_at))
        .limit(1);

      // Drizzle's db.execute pre-serializes timestamps to ISO strings (unlike
      // the typed select builder, which returns Date). Accept either shape.
      const lastAt = r.last_message_at;
      const lastAtIso = typeof lastAt === "string"
        ? lastAt
        : lastAt instanceof Date
          ? lastAt.toISOString()
          : null;

      return {
        other_user: otherUser ? {
          id: otherUser.id,
          first_name: otherUser.first_name,
          last_name: otherUser.last_name,
          role: otherUser.role,
          verification_status: otherUser.verification_status,
          average_rating: null,
        } : undefined,
        last_message: conv[0]?.message_text ?? "",
        last_message_at: lastAtIso,
        unread_count: Number(r.unread_count ?? 0),
      };
    }));

    return jsonResponse(conversations);
  } catch (err) {
    return handleError(err, req);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireAuth(req);
    const body = await parseBody(req, SendMessageBody);

    const [msg] = await db.insert(messagesTable).values({
      sender_id: me.id,
      recipient_id: body.recipient_id,
      booking_id: body.booking_id ?? null,
      message_text: body.message_text,
      message_type: "text",
    }).returning();

    return jsonResponse(msg, { status: 201 });
  } catch (err) {
    return handleError(err, req);
  }
}