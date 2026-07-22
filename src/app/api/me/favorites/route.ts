import { NextRequest } from "next/server";
import { and, eq, inArray, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  propertyFavoritesTable,
  propertiesTable,
  usersTable,
  propertyPhotosTable,
  trustScoresTable,
} from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse } from "@/lib/api";
import { formatTrustScore } from "@/lib/format";
import type { PropertySummary } from "@/api/generated/api.schemas";

/**
 * GET /api/me/favorites — the calling user's saved properties.
 *
 * Returns a `PropertySummary[]` shaped exactly like GET /api/properties so the
 * dashboard Saved tab can reuse <PropertyCard> with no adapter. Ordered by most
 * recently saved first. Only `live` properties are returned — if a saved
 * listing is later unpublished/suspended it drops out of the saved list.
 */
export async function GET(req: NextRequest) {
  try {
    const me = await requireAuth(req);

    const saved = await db
      .select({
        favorite_id: propertyFavoritesTable.id,
        property_id: propertyFavoritesTable.property_id,
        created_at: propertyFavoritesTable.created_at,
      })
      .from(propertyFavoritesTable)
      .where(eq(propertyFavoritesTable.user_id, me.id))
      .orderBy(desc(propertyFavoritesTable.created_at));

    const ids = saved.map((s) => s.property_id);
    if (ids.length === 0) return jsonResponse({ data: [] });

    const rows = await db
      .select()
      .from(propertiesTable)
      .where(
        and(
          inArray(propertiesTable.id, ids),
          // Only show saved listings that are still live.
          eq(propertiesTable.listing_status, "live"),
        ),
      );

    const landlordIds = Array.from(new Set(rows.map((r) => r.landlord_id)));
    const [photos, landlords, trust] = await Promise.all([
      db
        .select()
        .from(propertyPhotosTable)
        .where(inArray(propertyPhotosTable.property_id, ids))
        .orderBy(propertyPhotosTable.photo_order),
      landlordIds.length
        ? db
            .select({
              id: usersTable.id,
              first_name: usersTable.first_name,
              last_name: usersTable.last_name,
              role: usersTable.role,
              verification_status: usersTable.verification_status,
            })
            .from(usersTable)
            .where(inArray(usersTable.id, landlordIds))
        : Promise.resolve([]),
      landlordIds.length
        ? db.select().from(trustScoresTable).where(inArray(trustScoresTable.user_id, landlordIds))
        : Promise.resolve([]),
    ]);

    const landlordMap = new Map(landlords.map((l) => [l.id, l]));
    const trustMap = new Map(trust.map((t) => [t.user_id, t]));
    const photoByProp = new Map<string, typeof photos>();
    for (const p of photos) {
      const list = photoByProp.get(p.property_id) ?? [];
      list.push(p);
      photoByProp.set(p.property_id, list);
    }

    // Preserve the saved-order (most recent first) even though the properties
    // query wasn't ordered by it.
    const orderIndex = new Map(saved.map((s, i) => [s.property_id, i]));
    const data: PropertySummary[] = rows
      .map((p) => {
        const l = landlordMap.get(p.landlord_id);
        const ts = trustMap.get(p.landlord_id);
        const hero = (photoByProp.get(p.id) ?? [])[0];
        return {
          id: p.id,
          address: p.address,
          rent_amount_ngn: p.rent_amount_ngn,
          deposit_amount_ngn: p.deposit_amount_ngn,
          rooms: p.rooms ?? 1,
          listing_status: p.listing_status ?? "draft",
          hero_photo_url: hero?.photo_url ?? null,
          amenities: p.amenities ?? {},
          created_at: p.created_at?.toISOString() ?? null,
          landlord: l
            ? {
                id: l.id,
                first_name: l.first_name,
                last_name: l.last_name,
                role: l.role,
                verification_status: l.verification_status,
                average_rating: ts?.average_rating ?? null,
              }
            : undefined,
          trust_score: formatTrustScore(ts)?.total_score ?? 0,
        } as PropertySummary;
      })
      .sort((a, b) => (orderIndex.get(a.id!) ?? 0) - (orderIndex.get(b.id!) ?? 0));

    return jsonResponse({ data });
  } catch (err) {
    return handleError(err, req);
  }
}
