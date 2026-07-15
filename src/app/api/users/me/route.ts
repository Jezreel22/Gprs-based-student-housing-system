import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { usersTable, trustScoresTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse, parseBody } from "@/lib/api";
import { formatTrustScore } from "@/lib/format";
import type { UserPublicProfile } from "@/api/generated/api.schemas";

export async function GET(req: NextRequest) {
  try {
    const me = await requireAuth(req);
    const [ts] = await db.select().from(trustScoresTable).where(eq(trustScoresTable.user_id, me.id)).limit(1);

    const response: UserPublicProfile = {
      id: me.id,
      email: me.email,
      role: me.role,
      first_name: me.first_name,
      last_name: me.last_name,
      profile_photo_url: me.profile_photo_url,
      verification_status: me.verification_status,
      account_suspended: me.account_suspended,
      phone_number: me.phone_number,
      matriculation_number: me.matriculation_number,
      suspension_reason: me.suspension_reason,
      created_at: me.created_at?.toISOString() ?? null,
      trust_score: formatTrustScore(ts),
    };
    return jsonResponse(response);
  } catch (err) {
    return handleError(err, req);
  }
}

// All optional — clients send only the fields they want to change.
const UpdateMeBody = z.object({
  first_name: z.string().min(1).max(80).optional(),
  last_name: z.string().min(1).max(80).optional(),
  phone_number: z.string().min(5).max(40).optional(),
  profile_photo_url: z.string().min(1).max(500).nullable().optional(),
});

/**
 * PUT /api/users/me — edit your own profile (name, phone, photo). The
 * authed user can only edit their own row, which is implicit since the
 * route operates on `me.id`. Mirrors /api/users/[id] but skips the
 * permission dance since the id is always the caller's.
 */
export async function PUT(req: NextRequest) {
  try {
    const me = await requireAuth(req);
    const body = await parseBody(req, UpdateMeBody);

    if (Object.keys(body).length === 0) {
      return jsonResponse({ message: "No changes", user: { id: me.id } });
    }

    await db
      .update(usersTable)
      .set({ ...body, updated_at: new Date() })
      .where(eq(usersTable.id, me.id));

    const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, me.id)).limit(1);
    const [ts] = await db.select().from(trustScoresTable).where(eq(trustScoresTable.user_id, me.id)).limit(1);

    const response: UserPublicProfile = {
      id: updated.id,
      email: updated.email,
      role: updated.role,
      first_name: updated.first_name,
      last_name: updated.last_name,
      profile_photo_url: updated.profile_photo_url,
      verification_status: updated.verification_status,
      account_suspended: updated.account_suspended,
      phone_number: updated.phone_number,
      matriculation_number: updated.matriculation_number,
      suspension_reason: updated.suspension_reason,
      created_at: updated.created_at?.toISOString() ?? null,
      trust_score: formatTrustScore(ts),
    };
    return jsonResponse({ message: "Updated", user: response });
  } catch (err) {
    return handleError(err, req);
  }
}