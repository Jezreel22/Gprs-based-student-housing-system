import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { usersTable, trustScoresTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse } from "@/lib/api";
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