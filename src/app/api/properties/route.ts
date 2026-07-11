import { NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, inArray, sql, gte, lte, desc, asc, SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { propertiesTable, usersTable, propertyPhotosTable, trustScoresTable, ratingsTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse, getQueryParams, errorResponse } from "@/lib/api";
import { formatTrustScore } from "@/lib/format";
import type { PropertyListResponse, PropertySummary } from "@/api/generated/api.schemas";

const GetPropertiesQuery = z.object({
  rent_min: z.coerce.number().int().nonnegative().optional(),
  rent_max: z.coerce.number().int().positive().optional(),
  rooms: z.coerce.number().int().positive().optional(),
  type: z.string().optional(),
  furnished: z.coerce.boolean().optional(),
  sort: z.enum(["newest", "cheapest", "most_trusted"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(50).optional(),
  landlord_type: z.enum(["landlord", "agent"]).optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const q = GetPropertiesQuery.parse(Object.fromEntries(getQueryParams(req)));

    const filters: SQL[] = [eq(propertiesTable.listing_status, "live")];
    if (q.rent_min != null) filters.push(gte(propertiesTable.rent_amount_ngn, q.rent_min));
    if (q.rent_max != null) filters.push(lte(propertiesTable.rent_amount_ngn, q.rent_max));
    if (q.rooms != null) filters.push(eq(propertiesTable.rooms, q.rooms));

    const where = filters.length > 1 ? and(...filters) : filters[0]!;

    const orderBy = q.sort === "cheapest"
      ? asc(propertiesTable.rent_amount_ngn)
      : q.sort === "most_trusted"
        ? desc(propertiesTable.published_at) // TODO: order by trust_score when trust_score recompute is wired
        : desc(propertiesTable.created_at);

    const page = q.page ?? 1;
    const pageSize = q.page_size ?? 12;
    const offset = (page - 1) * pageSize;

    const [rows, totalRows] = await Promise.all([
      db.select().from(propertiesTable).where(where).orderBy(orderBy).limit(pageSize).offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(propertiesTable).where(where),
    ]);

    const total = totalRows[0]?.count ?? 0;

    // Fetch hero photo + landlord summary for each row in one shot
    const ids = rows.map((r) => r.id);
    const landlordIds = Array.from(new Set(rows.map((r) => r.landlord_id)));

    const [photos, landlords, trust] = await Promise.all([
      ids.length > 0
        ? db.select().from(propertyPhotosTable).where(inArray(propertyPhotosTable.property_id, ids)).orderBy(asc(propertyPhotosTable.photo_order))
        : Promise.resolve([]),
      landlordIds.length > 0
        ? db.select({
            id: usersTable.id,
            first_name: usersTable.first_name,
            last_name: usersTable.last_name,
            role: usersTable.role,
            verification_status: usersTable.verification_status,
          }).from(usersTable).where(inArray(usersTable.id, landlordIds))
        : Promise.resolve([]),
      landlordIds.length > 0
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

    const data: PropertySummary[] = rows.map((p) => {
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
        landlord: l ? {
          id: l.id,
          first_name: l.first_name,
          last_name: l.last_name,
          role: l.role,
          verification_status: l.verification_status,
          average_rating: ts?.average_rating ?? null,
        } : undefined,
        trust_score: formatTrustScore(ts)?.total_score ?? 0,
      };
    });

    const response: PropertyListResponse = { data, total, page, page_size: pageSize };
    return jsonResponse(response);
  } catch (err) {
    return handleError(err, req);
  }
}

const CreatePropertyBody = z.object({
  address: z.string().min(5),
  rent_amount_ngn: z.number().int().positive(),
  deposit_amount_ngn: z.number().int().positive(),
  lease_duration_days: z.number().int().min(30).optional(),
  rooms: z.number().int().min(1).max(20),
  amenities: z.record(z.boolean()).optional(),
  house_rules: z.string().optional(),
  description: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

function generateOccupancyCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireAuth(req);
    if (!["landlord", "agent"].includes(me.role)) {
      return errorResponse("Only landlords and agents can create listings", 403);
    }

    const body = await parseBody(req, CreatePropertyBody);

    // Retry on the (very unlikely) event of a collision on the 6-character
    // occupancy code. Anything else — DB down, bad data — bubbles immediately.
    const isUniqueViolation = (err: unknown) =>
      typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";

    let lastErr: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const [property] = await db.insert(propertiesTable).values({
          landlord_id: me.id,
          address: body.address,
          rent_amount_ngn: body.rent_amount_ngn,
          deposit_amount_ngn: body.deposit_amount_ngn,
          lease_duration_days: body.lease_duration_days ?? null,
          rooms: body.rooms,
          amenities: body.amenities ?? {},
          house_rules: body.house_rules ?? null,
          description: body.description ?? null,
          latitude: body.latitude ?? null,
          longitude: body.longitude ?? null,
          occupancy_code: generateOccupancyCode(),
          listing_status: "draft",
        }).returning();

        if (!property) {
          return errorResponse("Failed to create property", 500);
        }
        return jsonResponse(property, { status: 201 });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        lastErr = err;
      }
    }
    throw lastErr ?? new Error("Could not allocate occupancy code");
  } catch (err) {
    return handleError(err, req);
  }
}