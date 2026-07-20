import { NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, gte, lte, inArray, sql, SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  propertiesTable,
  usersTable,
  propertyPhotosTable,
  trustScoresTable,
} from "@/lib/db/schema";
import { handleError, jsonResponse, getQueryParams } from "@/lib/api";
import { formatTrustScore } from "@/lib/format";
import { TRUST_BASELINE } from "@/lib/trust/levels";

// ─── Nigerian Army University Biu — default map centre ────────────────────
export const NAUB_LAT = 10.6102;
export const NAUB_LNG = 12.1978;

// ─── Haversine distance formula in PostgreSQL (returns km) ────────────────
// Uses the spherical law of cosines: accurate to within ~1 m for these scales.
// The literal 6371 is the mean Earth radius in kilometres.
function haversineDistanceSql(
  latCol: typeof propertiesTable.latitude,
  lngCol: typeof propertiesTable.longitude,
  refLat: number,
  refLng: number
): SQL<number> {
  return sql<number>`(
    6371 * acos(
      LEAST(1.0, GREATEST(-1.0,
        cos(radians(${refLat})) *
        cos(radians(${latCol})) *
        cos(radians(${lngCol}) - radians(${refLng})) +
        sin(radians(${refLat})) *
        sin(radians(${latCol}))
      ))
    )
  )`;
}

// ─── Query schema ─────────────────────────────────────────────────────────
const NearbyQuery = z.object({
  // Centre of the search (defaults to NAUB when omitted)
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),

  // Visible map bounds — only return markers inside this box when supplied
  bounds_north: z.coerce.number().optional(),
  bounds_south: z.coerce.number().optional(),
  bounds_east: z.coerce.number().optional(),
  bounds_west: z.coerce.number().optional(),

  // Radius in km to search (default 5 km, max 50 km)
  radius_km: z.coerce.number().positive().max(50).optional(),

  // Existing property filters (mirrors the main /api/properties endpoint)
  rent_min: z.coerce.number().int().nonnegative().optional(),
  rent_max: z.coerce.number().int().positive().optional(),
  rooms: z.coerce.number().int().positive().optional(),
  trust_score_min: z.coerce.number().int().min(0).max(100).optional(),
  verified_only: z.coerce.boolean().optional(),

  // Pagination
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(50).optional(),
});

export type NearbyProperty = {
  id: string;
  address: string;
  latitude: number;
  longitude: number;
  rent_amount_ngn: number;
  deposit_amount_ngn: number;
  rooms: number;
  listing_status: string;
  amenities: Record<string, boolean>;
  hero_photo_url: string | null;
  created_at: string | null;
  trust_score: number;
  distance_from_centre_km: number;
  distance_from_naub_km: number;
  landlord: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    role: string;
    verification_status: string | null;
    average_rating: number | null;
  } | null;
};

export async function GET(req: NextRequest) {
  try {
    const params = NearbyQuery.parse(
      Object.fromEntries(getQueryParams(req))
    );

    const centLat = params.lat ?? NAUB_LAT;
    const centLng = params.lng ?? NAUB_LNG;
    const radiusKm = params.radius_km ?? 5;
    const page = params.page ?? 1;
    const pageSize = params.page_size ?? 20;
    const offset = (page - 1) * pageSize;

    const distanceSql = haversineDistanceSql(
      propertiesTable.latitude,
      propertiesTable.longitude,
      centLat,
      centLng
    );

    const distanceFromNaubSql = haversineDistanceSql(
      propertiesTable.latitude,
      propertiesTable.longitude,
      NAUB_LAT,
      NAUB_LNG
    );

    // ── Base filters ────────────────────────────────────────────────────
    const filters: SQL[] = [
      eq(propertiesTable.listing_status, "live"),
      // Must have valid coordinates to appear on the map
      sql`${propertiesTable.latitude} IS NOT NULL`,
      sql`${propertiesTable.longitude} IS NOT NULL`,
      // Within the requested radius
      sql`${distanceSql} <= ${radiusKm}`,
    ];

    // ── Optional visible-bounds filter (only return markers in viewport) ─
    if (
      params.bounds_north != null &&
      params.bounds_south != null &&
      params.bounds_east != null &&
      params.bounds_west != null
    ) {
      filters.push(
        gte(propertiesTable.latitude, params.bounds_south),
        lte(propertiesTable.latitude, params.bounds_north),
        gte(propertiesTable.longitude, params.bounds_west),
        lte(propertiesTable.longitude, params.bounds_east)
      );
    }

    if (params.rent_min != null)
      filters.push(gte(propertiesTable.rent_amount_ngn, params.rent_min));
    if (params.rent_max != null)
      filters.push(lte(propertiesTable.rent_amount_ngn, params.rent_max));
    if (params.rooms != null)
      filters.push(eq(propertiesTable.rooms, params.rooms));

    // ── Trust score filter — resolve qualifying landlord IDs ─────────────
    if (params.trust_score_min != null) {
      const matches = await db
        .select({ user_id: trustScoresTable.user_id })
        .from(trustScoresTable)
        .where(gte(trustScoresTable.total_score, params.trust_score_min));
      filters.push(
        matches.length > 0
          ? inArray(
              propertiesTable.landlord_id,
              matches.map((m) => m.user_id)
            )
          : sql`false`
      );
    }

    // ── Verified landlord filter ─────────────────────────────────────────
    if (params.verified_only) {
      const verified = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.verification_status, "verified"));
      filters.push(
        verified.length > 0
          ? inArray(
              propertiesTable.landlord_id,
              verified.map((u) => u.id)
            )
          : sql`false`
      );
    }

    const baseWhere = and(...filters)!;

    // ── Main query — sorted by nearest first ────────────────────────────
    const [rows, countRows] = await Promise.all([
      db
        .select({
          prop: propertiesTable,
          distance_km: distanceSql,
          distance_from_naub_km: distanceFromNaubSql,
        })
        .from(propertiesTable)
        .where(baseWhere)
        .orderBy(distanceSql)
        .limit(pageSize)
        .offset(offset),

      db
        .select({ count: sql<number>`count(*)::int` })
        .from(propertiesTable)
        .where(baseWhere),
    ]);

    const total = countRows[0]?.count ?? 0;

    if (rows.length === 0) {
      return jsonResponse({ data: [], total, page, page_size: pageSize });
    }

    const propIds = rows.map((r) => r.prop.id);
    const landlordIds = Array.from(
      new Set(rows.map((r) => r.prop.landlord_id))
    );

    const [photos, landlords, trust] = await Promise.all([
      db
        .select()
        .from(propertyPhotosTable)
        .where(inArray(propertyPhotosTable.property_id, propIds)),
      db
        .select({
          id: usersTable.id,
          first_name: usersTable.first_name,
          last_name: usersTable.last_name,
          role: usersTable.role,
          verification_status: usersTable.verification_status,
        })
        .from(usersTable)
        .where(inArray(usersTable.id, landlordIds)),
      db
        .select()
        .from(trustScoresTable)
        .where(inArray(trustScoresTable.user_id, landlordIds)),
    ]);

    const photoByProp = new Map<string, typeof photos>();
    for (const p of photos) {
      const list = photoByProp.get(p.property_id) ?? [];
      list.push(p);
      photoByProp.set(p.property_id, list);
    }
    const landlordMap = new Map(landlords.map((l) => [l.id, l]));
    const trustMap = new Map(trust.map((t) => [t.user_id, t]));

    const data: NearbyProperty[] = rows.map(
      ({ prop: p, distance_km, distance_from_naub_km }) => {
        const l = landlordMap.get(p.landlord_id) ?? null;
        const ts = trustMap.get(p.landlord_id);
        const hero = (photoByProp.get(p.id) ?? [])[0];
        return {
          id: p.id,
          address: p.address,
          latitude: p.latitude!,
          longitude: p.longitude!,
          rent_amount_ngn: p.rent_amount_ngn,
          deposit_amount_ngn: p.deposit_amount_ngn,
          rooms: p.rooms ?? 1,
          listing_status: p.listing_status ?? "draft",
          amenities: (p.amenities ?? {}) as Record<string, boolean>,
          hero_photo_url: hero?.photo_url ?? null,
          created_at: p.created_at?.toISOString() ?? null,
          trust_score: formatTrustScore(ts)?.total_score ?? TRUST_BASELINE,
          distance_from_centre_km: Number(distance_km.toFixed(3)),
          distance_from_naub_km: Number(distance_from_naub_km.toFixed(3)),
          landlord: l
            ? {
                id: l.id,
                first_name: l.first_name,
                last_name: l.last_name,
                role: l.role,
                verification_status: l.verification_status,
                average_rating: ts?.average_rating ?? null,
              }
            : null,
        };
      }
    );

    return jsonResponse({ data, total, page, page_size: pageSize });
  } catch (err) {
    return handleError(err, req);
  }
}
