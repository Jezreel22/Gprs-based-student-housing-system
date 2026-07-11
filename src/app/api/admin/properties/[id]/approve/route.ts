import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { propertiesTable, auditLogTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse, errorResponse } from "@/lib/api";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const officer = await requireAuth(req);
    if (officer.role !== "escrow_officer") throw new Error("Forbidden");
    const { id } = await params;
    const [p] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, id)).limit(1);
    if (!p) return errorResponse("Property not found", 404);

    await db.update(propertiesTable).set({
      listing_status: "live",
      published_at: new Date(),
      updated_at: new Date(),
    }).where(eq(propertiesTable.id, id));

    await db.insert(auditLogTable).values({
      actor_id: officer.id,
      action_type: "property_approved",
      resource_type: "property",
      resource_id: id,
    });

    return jsonResponse({ message: "Property published live" });
  } catch (err) {
    return handleError(err, req);
  }
}