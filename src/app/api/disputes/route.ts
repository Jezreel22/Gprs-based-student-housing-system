import { NextRequest } from "next/server";
import { eq, or, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { disputesTable, usersTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse } from "@/lib/api";
import type { DisputeDetail, LandlordSummary } from "@/api/generated/api.schemas";

export async function GET(req: NextRequest) {
  try {
    const me = await requireAuth(req);

    // Admin sees all disputes; everyone else only sees their own.
    const rows = me.role === "escrow_officer"
      ? await db.select().from(disputesTable)
      : await db.select().from(disputesTable)
          .where(or(eq(disputesTable.student_id, me.id), eq(disputesTable.landlord_id, me.id)));

    const userIds = Array.from(new Set([
      ...rows.map((d) => d.student_id),
      ...rows.map((d) => d.landlord_id),
    ]));

    const usersList = userIds.length > 0
      ? await db.select().from(usersTable).where(inArray(usersTable.id, userIds))
      : [];
    const userMap = new Map(usersList.map((u) => [u.id, u]));

    const summary = (uid: string): LandlordSummary | undefined => {
      const u = userMap.get(uid);
      if (!u) return undefined;
      return {
        id: u.id,
        first_name: u.first_name,
        last_name: u.last_name,
        role: u.role,
        verification_status: u.verification_status,
      };
    };

    const data: DisputeDetail[] = rows.map((d) => ({
      id: d.id,
      booking_id: d.booking_id,
      student_id: d.student_id,
      landlord_id: d.landlord_id,
      reason: d.reason,
      description: d.description,
      dispute_status: d.dispute_status ?? "open",
      adjudication_decision: d.adjudication_decision ?? null,
      adjudication_notes: d.adjudication_notes ?? null,
      created_at: d.created_at?.toISOString() ?? null,
      resolved_at: d.resolved_at?.toISOString() ?? null,
      student: summary(d.student_id),
      landlord: summary(d.landlord_id),
    }));

    return jsonResponse(data);
  } catch (err) {
    return handleError(err, req);
  }
}