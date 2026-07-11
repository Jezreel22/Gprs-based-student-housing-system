import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { usersTable, trustScoresTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse, parseBody } from "@/lib/api";
import { formatTrustScore } from "@/lib/format";
import type { UserPublicProfile } from "@/api/generated/api.schemas";

const UpdateUserSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  phone_number: z.string().optional(),
  profile_photo_url: z.string().optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAuth(req);
    const { id } = await params;
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!u) return jsonResponse({ error: "User not found" }, { status: 404 });
    const [ts] = await db.select().from(trustScoresTable).where(eq(trustScoresTable.user_id, u.id)).limit(1);

    const response: UserPublicProfile = {
      id: u.id,
      email: u.email,
      role: u.role,
      first_name: u.first_name,
      last_name: u.last_name,
      profile_photo_url: u.profile_photo_url,
      verification_status: u.verification_status,
      account_suspended: u.account_suspended,
      phone_number: u.phone_number,
      matriculation_number: u.matriculation_number,
      suspension_reason: u.suspension_reason,
      created_at: u.created_at?.toISOString() ?? null,
      trust_score: formatTrustScore(ts),
    };
    return jsonResponse(response);
  } catch (err) {
    return handleError(err, req);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireAuth(req);
    const { id } = await params;
    if (me.id !== id && me.role !== "escrow_officer") {
      return jsonResponse({ error: "Cannot edit another user" }, { status: 403 });
    }

    const body = await parseBody(req, UpdateUserSchema);
    await db.update(usersTable)
      .set({ ...body, updated_at: new Date() })
      .where(eq(usersTable.id, id));

    const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    return jsonResponse({ message: "Updated", user: updated });
  } catch (err) {
    return handleError(err, req);
  }
}