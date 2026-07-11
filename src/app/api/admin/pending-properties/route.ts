import { NextRequest } from "next/server";
import { eq, inArray, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { propertiesTable, propertyPhotosTable, usersTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse } from "@/lib/api";
import type { PropertyListResponse, PropertySummary } from "@/api/generated/api.schemas";

export async function GET(req: NextRequest) {
  try {
    const me = await requireAuth(req);
    if (me.role !== "escrow_officer") throw new Error("Forbidden");

    const props = await db.select().from(propertiesTable).where(eq(propertiesTable.listing_status, "pending"));
    const propIds = props.map((p) => p.id);
    const landlordIds = Array.from(new Set(props.map((p) => p.landlord_id)));

    const [photos, landlords] = await Promise.all([
      propIds.length > 0
        ? db.select().from(propertyPhotosTable).where(inArray(propertyPhotosTable.property_id, propIds)).orderBy(asc(propertyPhotosTable.photo_order))
        : Promise.resolve([]),
      landlordIds.length > 0
        ? db.select().from(usersTable).where(inArray(usersTable.id, landlordIds))
        : Promise.resolve([]),
    ]);

    const landlordMap = new Map(landlords.map((l) => [l.id, l]));
    const heroByProp = new Map<string, string>();
    for (const p of photos) {
      if (!heroByProp.has(p.property_id)) heroByProp.set(p.property_id, p.photo_url);
    }

    const data: PropertySummary[] = props.map((p) => ({
      id: p.id,
      address: p.address,
      rent_amount_ngn: p.rent_amount_ngn,
      deposit_amount_ngn: p.deposit_amount_ngn,
      rooms: p.rooms ?? 1,
      listing_status: p.listing_status ?? "pending",
      hero_photo_url: heroByProp.get(p.id) ?? null,
      amenities: p.amenities ?? {},
      created_at: p.created_at?.toISOString() ?? null,
      landlord: (() => {
        const l = landlordMap.get(p.landlord_id);
        if (!l) return undefined;
        return {
          id: l.id,
          first_name: l.first_name,
          last_name: l.last_name,
          role: l.role,
          verification_status: l.verification_status,
          average_rating: null,
        };
      })(),
    }));

    const response: PropertyListResponse = { data, total: data.length, page: 1, page_size: data.length };
    return jsonResponse(response);
  } catch (err) {
    return handleError(err, req);
  }
}