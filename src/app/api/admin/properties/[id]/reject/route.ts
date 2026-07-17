import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { propertiesTable, auditLogTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse, errorResponse } from "@/lib/api";
import { recordTrustEvent } from "@/lib/trust/service";

const RejectBody = z.object({ reason: z.string().min(5) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const officer = await requireAuth(req);
    if (officer.role !== "escrow_officer") throw new Error("Forbidden");
    const { id } = await params;
    const body = await parseBody(req, RejectBody);

    const [p] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, id)).limit(1);
    if (!p) return errorResponse("Property not found", 404);

    await db.update(propertiesTable).set({
      listing_status: "suspended",
      updated_at: new Date(),
    }).where(eq(propertiesTable.id, id));

    await db.insert(auditLogTable).values({
      actor_id: officer.id,
      action_type: "property_rejected",
      resource_type: "property",
      resource_id: id,
      details: { reason: body.reason },
    });

    await recordTrustEvent({
      userId: p.landlord_id,
      ruleKey: "fake_property_listing",
      sourceType: "property",
      sourceId: id,
      dedupeKey: `fake-listing:${id}`,
      actorId: officer.id,
      reason: "Property rejected as fake or non-compliant",
      details: { reason: body.reason },
    });

    return jsonResponse({ message: "Property rejected" });
  } catch (err) {
    return handleError(err, req);
  }
}