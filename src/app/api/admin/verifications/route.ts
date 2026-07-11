import { NextRequest } from "next/server";
import { eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { usersTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse } from "@/lib/api";
import type { User } from "@/api/generated/api.schemas";

export async function GET(req: NextRequest) {
  try {
    const me = await requireAuth(req);
    if (me.role !== "escrow_officer") throw new Error("Forbidden");

    const rows = await db.select().from(usersTable).where(eq(usersTable.verification_status, "under_review"));

    // Drop noise fields the UI doesn't render
    const data: User[] = rows.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      first_name: u.first_name,
      last_name: u.last_name,
      matriculation_number: u.matriculation_number,
      verification_status: u.verification_status,
      account_suspended: u.account_suspended,
      phone_number: u.phone_number,
      profile_photo_url: u.profile_photo_url,
      created_at: u.created_at?.toISOString() ?? null,
    }));

    return jsonResponse(data);
  } catch (err) {
    return handleError(err, req);
  }
}