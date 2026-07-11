import { NextRequest } from "next/server";
import { eq, desc, inArray, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { propertiesTable, propertyPhotosTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse } from "@/lib/api";
import type { PropertyListResponse, PropertySummary } from "@/api/generated/api.schemas";

export async function GET(req: NextRequest) {
  try {
    const me = await requireAuth(req);
    const rows = await db.select().from(propertiesTable)
      .where(eq(propertiesTable.landlord_id, me.id))
      .orderBy(desc(propertiesTable.created_at));

    const ids = rows.map((r) => r.id);
    const photos = ids.length > 0
      ? await db.select().from(propertyPhotosTable).where(inArray(propertyPhotosTable.property_id, ids)).orderBy(asc(propertyPhotosTable.photo_order))
      : [];
    const heroByProp = new Map<string, string>();
    for (const p of photos) {
      if (!heroByProp.has(p.property_id)) heroByProp.set(p.property_id, p.photo_url);
    }

    const data: PropertySummary[] = rows.map((p) => ({
      id: p.id,
      address: p.address,
      rent_amount_ngn: p.rent_amount_ngn,
      deposit_amount_ngn: p.deposit_amount_ngn,
      rooms: p.rooms ?? 1,
      listing_status: p.listing_status ?? "draft",
      hero_photo_url: heroByProp.get(p.id) ?? null,
      amenities: p.amenities ?? {},
      created_at: p.created_at?.toISOString() ?? null,
    }));

    const response: PropertyListResponse = {
      data,
      total: data.length,
      page: 1,
      page_size: data.length,
    };
    return jsonResponse(response);
  } catch (err) {
    return handleError(err, req);
  }
}