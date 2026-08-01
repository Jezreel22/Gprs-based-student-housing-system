/**
 * GET /api/admin/gps-verifications
 *
 * Officer-only queue for Feature 7 (Property GPS Verification). Lists every
 * property whose `gps_verification_status = 'pending'` so an officer can
 * compare the landlord-submitted coordinates (`latitude`/`longitude`)
 * against officer-verified coordinates (`verified_latitude`/
 * `verified_longitude`) and approve or reject.
 *
 * Response shape is bespoke rather than `PropertyListResponse` because the
 * GPS queue carries fields the generated schema doesn't: the verified
 * coords, the server-computed delta (km) between submitted and verified,
 * and full landlord info. Matches the bespoke envelope used by the
 * `/api/admin/bookings` and `/api/admin/reports` routes.
 *
 * Server-computed distance uses `haversineKm` from `@/lib/maps/utils`
 * (pure, no browser globals — safe to import here).
 */

import { NextRequest } from "next/server";
import { eq, inArray, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { propertiesTable, propertyPhotosTable, usersTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse } from "@/lib/api";
import { haversineKm } from "@/lib/maps/utils";

export async function GET(req: NextRequest) {
  try {
    const me = await requireAuth(req);
    if (me.role !== "escrow_officer") throw new Error("Forbidden");

    const props = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.gps_verification_status, "pending"));

    const propIds = props.map((p) => p.id);
    const landlordIds = Array.from(new Set(props.map((p) => p.landlord_id)));

    const [photos, landlords] = await Promise.all([
      propIds.length > 0
        ? db
            .select()
            .from(propertyPhotosTable)
            .where(inArray(propertyPhotosTable.property_id, propIds))
            .orderBy(asc(propertyPhotosTable.photo_order))
        : Promise.resolve([]),
      landlordIds.length > 0
        ? db
            .select({
              id: usersTable.id,
              first_name: usersTable.first_name,
              last_name: usersTable.last_name,
              email: usersTable.email,
              role: usersTable.role,
              verification_status: usersTable.verification_status,
            })
            .from(usersTable)
            .where(inArray(usersTable.id, landlordIds))
        : Promise.resolve([]),
    ]);

    const landlordMap = new Map(landlords.map((l) => [l.id, l]));
    const heroByProp = new Map<string, string>();
    for (const p of photos) {
      if (!heroByProp.has(p.property_id)) heroByProp.set(p.property_id, p.photo_url);
    }

    const data = props.map((p) => {
      const landlord = landlordMap.get(p.landlord_id);
      const hasSubmitted = p.latitude != null && p.longitude != null;
      const hasVerified =
        p.verified_latitude != null && p.verified_longitude != null;
      return {
        id: p.id,
        address: p.address,
        latitude: p.latitude,
        longitude: p.longitude,
        verified_latitude: p.verified_latitude,
        verified_longitude: p.verified_longitude,
        gps_verification_status: p.gps_verification_status ?? "pending",
        rent_amount_ngn: p.rent_amount_ngn,
        rooms: p.rooms ?? 1,
        hero_photo_url: heroByProp.get(p.id) ?? null,
        created_at: p.created_at?.toISOString() ?? null,
        // Server-computed delta (km) between submitted and verified coords.
        // null when either pair is missing.
        coord_delta_km:
          hasSubmitted && hasVerified
            ? Number(
                haversineKm(
                  { lat: p.latitude!, lng: p.longitude! },
                  { lat: p.verified_latitude!, lng: p.verified_longitude! },
                ).toFixed(3),
              )
            : null,
        landlord: landlord
          ? {
              id: landlord.id,
              first_name: landlord.first_name,
              last_name: landlord.last_name,
              email: landlord.email,
              role: landlord.role,
              verification_status: landlord.verification_status,
            }
          : null,
      };
    });

    return jsonResponse({ data, total: data.length });
  } catch (err) {
    return handleError(err, req);
  }
}