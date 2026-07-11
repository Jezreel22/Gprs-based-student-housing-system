import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { propertiesTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse, errorResponse } from "@/lib/api";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireAuth(req);
    const { id } = await params;

    const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, id)).limit(1);
    if (!property) return errorResponse("Property not found", 404);
    if (property.landlord_id !== me.id) return errorResponse("Not your listing", 403);

    await db.update(propertiesTable)
      .set({ listing_status: "pending", updated_at: new Date() })
      .where(eq(propertiesTable.id, id));

    return jsonResponse({ message: "Listing submitted for review", listing_status: "pending" });
  } catch (err) {
    return handleError(err, req);
  }
}