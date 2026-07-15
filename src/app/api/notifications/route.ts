import { NextRequest } from "next/server";
import { z } from "zod";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { notificationsTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse } from "@/lib/api";

const LIMIT = 25;

/**
 * GET /api/notifications — return the authed user's most recent notifications
 * (newest first, capped at LIMIT) and the unread count. Used by the bell icon
 * and its 30s polling loop.
 */
export async function GET(req: NextRequest) {
  try {
    const me = await requireAuth(req);

    const items = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.user_id, me.id))
      .orderBy(desc(notificationsTable.created_at))
      .limit(LIMIT);

    const unread_count = items.filter((n) => n.read_at == null).length;

    return jsonResponse({
      unread_count,
      items: items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body ?? null,
        related_id: n.related_id ?? null,
        related_type: n.related_type ?? null,
        read_at: n.read_at?.toISOString() ?? null,
        created_at: n.created_at?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    return handleError(err, req);
  }
}

const MarkReadBody = z.object({
  // Mark a specific notification read; the caller must own it (enforced in
  // the WHERE). Pass `all: true` to mark every unread notification for the
  // user as read in one go (the bell uses this when the popover opens).
  id: z.string().uuid().optional(),
  all: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const me = await requireAuth(req);
    const body = await parseBody(req, MarkReadBody);

    if (body.id) {
      // Only flip the user's own row — silently no-op on a foreign id.
      await db
        .update(notificationsTable)
        .set({ read_at: new Date() })
        .where(
          and(
            eq(notificationsTable.id, body.id),
            eq(notificationsTable.user_id, me.id),
          ),
        );
    } else if (body.all) {
      await db
        .update(notificationsTable)
        .set({ read_at: new Date() })
        .where(
          and(
            eq(notificationsTable.user_id, me.id),
            isNull(notificationsTable.read_at),
          ),
        );
    } else {
      // Default: mark the most recent N (matches the GET cap) as read so
      // opening the bell clears the badge without an explicit "mark all".
      const recent = await db
        .select({ id: notificationsTable.id })
        .from(notificationsTable)
        .where(
          and(
            eq(notificationsTable.user_id, me.id),
            isNull(notificationsTable.read_at),
          ),
        )
        .orderBy(desc(notificationsTable.created_at))
        .limit(LIMIT);
      const ids = recent.map((r) => r.id);
      if (ids.length > 0) {
        await db
          .update(notificationsTable)
          .set({ read_at: new Date() })
          .where(
            and(
              eq(notificationsTable.user_id, me.id),
              inArray(notificationsTable.id, ids),
            ),
          );
      }
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return handleError(err, req);
  }
}