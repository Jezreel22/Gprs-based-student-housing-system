import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { usersTable, auditLogTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse, errorResponse } from "@/lib/api";
import { recordTrustEvent } from "@/lib/trust/service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const officer = await requireAuth(req);
    if (officer.role !== "escrow_officer") throw new Error("Forbidden");
    const { id } = await params;
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    if (!u) return errorResponse("User not found", 404);

    await db.update(usersTable).set({
      verification_status: "verified",
      national_id_verified_at: new Date(),
      selfie_verified_at: new Date(),
      updated_at: new Date(),
    }).where(eq(usersTable.id, id));

    await db.insert(auditLogTable).values({
      actor_id: officer.id,
      action_type: "verification_approved",
      resource_type: "user",
      resource_id: id,
    });

    // Award government_id_verified trust points to landlords and agents who go
    // through KYC. Students are not KYC-verified, so we skip them here.
    if (["landlord", "agent"].includes(u.role)) {
      await recordTrustEvent({
        userId: id,
        ruleKey: "government_id_verified",
        sourceType: "user",
        sourceId: id,
        dedupeKey: `government-id:${id}`,
        actorId: officer.id,
        reason: "Government ID verified by officer",
      });
    }

    return jsonResponse({ message: "User verified" });
  } catch (err) {
    return handleError(err, req);
  }
}