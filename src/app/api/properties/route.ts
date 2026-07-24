import { NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, inArray, sql, gte, lte, ilike, desc, asc, SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { propertiesTable, usersTable, trustScoresTable, ratingsTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse, getQueryParams, errorResponse } from "@/lib/api";
import { logFromRequest } from "@/lib/log";
import { formatTrustScore } from "@/lib/format";
import { TRUST_BASELINE } from "@/lib/trust/levels";
import type { PropertyListResponse, PropertySummary } from "@/api/generated/api.schemas";

const GetPropertiesQuery = z.object({
  // Free-text search across the address field. Matches Maiduguri Road, Biu,
  // "off Ahmadu Bello Way", etc. via case-insensitive substring.
  q: z.string().trim().min(1).max(120).optional(),
  rent_min: z.coerce.number().int().nonnegative().optional(),
  rent_max: z.coerce.number().int().positive().optional(),
  rooms: z.coerce.number().int().positive().optional(),
  // Coarse categorical filter the landing categories send. Self-Contained maps
  // to a single-room listing; no separate `property_type` column exists yet.
  type: z.enum(["self_contained", "single_room", "flat", "shared"]).optional(),
  furnished: z.coerce.boolean().optional(),
  trust_score_min: z.coerce.number().int().min(0).max(100).optional(),
  landlord_type: z.enum(["landlord", "agent"]).optional(),
  sort: z.enum(["newest", "cheapest", "most_trusted"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  page_size: z.coerce.number().int().positive().max(50).optional(),
});

export const runtime = "nodejs";
// Keep database-backed listings close to the Supabase project in Frankfurt
// (`aws-0-eu-central-1.pooler.supabase.com`) instead of allowing Vercel to run
// the cold function in a distant region.
export const preferredRegion = "fra1";
// Gives a cold DB connection room to complete instead of Vercel returning a
// generic function timeout before the route can log the actual cause.
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const logger = logFromRequest(req);
  const startedAt = Date.now();

  try {
    // GET is intentionally public so anonymous visitors can browse live
    // listings, search, and use filters. Write paths (POST) and authenticated
    // endpoints still call requireAuth.
    const q = GetPropertiesQuery.parse(Object.fromEntries(getQueryParams(req)));

    // Structured log so we can see in Vercel which query path was taken,
    // which sort/filter combo, and the resulting page size. This is what makes
    // a future "listings disappeared" debuggable instead of a silent 504.
    logger.info("api.properties.GET", {
      sort: q.sort ?? "newest",
      page: q.page ?? 1,
      page_size: q.page_size ?? 12,
      q: q.q ?? null,
      rent_min: q.rent_min ?? null,
      rent_max: q.rent_max ?? null,
      rooms: q.rooms ?? null,
      trust_score_min: q.trust_score_min ?? null,
      landlord_type: q.landlord_type ?? null,
    });

    const filters: SQL[] = [eq(propertiesTable.listing_status, "live")];

    if (q.q) {
      // Sanitise wildcards; ILIKE itself is parameter-bound so injection isn't
      // a concern, but stripping '%' and '_' keeps the search predictable.
      const term = `%${q.q.replace(/[%_]/g, (c) => `\\${c}`)}%`;
      filters.push(ilike(propertiesTable.address, term));
    }
    if (q.rent_min != null) filters.push(gte(propertiesTable.rent_amount_ngn, q.rent_min));
    if (q.rent_max != null) filters.push(lte(propertiesTable.rent_amount_ngn, q.rent_max));
    if (q.rooms != null) filters.push(eq(propertiesTable.rooms, q.rooms));

    // Coarse type → room mapping. The DB has no property_type column.
    if (q.type === "self_contained" || q.type === "single_room") filters.push(eq(propertiesTable.rooms, 1));
    if (q.type === "flat") filters.push(eq(propertiesTable.rooms, 2));

    // Furnished lives inside the jsonb `amenities` column on each listing
    // (landlords tick the "Furnished" amenity when creating a listing).
    if (q.furnished === true) {
      filters.push(sql`${propertiesTable.amenities}->>'furnished' = 'true'`);
    }

    // landlord_type (usersTable.role) and trust_score_min (trust_scores.total_score)
    // are keyed off the listing's landlord, not the property row. Resolve the
    // qualifying landlord ids up front and fold them into the WHERE as an
    // inArray — keeps the main query join-free and the pagination `total` exact,
    // rather than the post-filter hack that lied about counts.
    if (q.landlord_type) {
      const matches = await db.select({ id: usersTable.id })
        .from(usersTable).where(eq(usersTable.role, q.landlord_type));
      filters.push(matches.length > 0
        ? inArray(propertiesTable.landlord_id, matches.map((m) => m.id))
        : sql`false`);
    }
    if (q.trust_score_min != null) {
      const matches = await db.select({ user_id: trustScoresTable.user_id })
        .from(trustScoresTable).where(gte(trustScoresTable.total_score, q.trust_score_min));
      filters.push(matches.length > 0
        ? inArray(propertiesTable.landlord_id, matches.map((m) => m.user_id))
        : sql`false`);
    }

    // `most_trusted` ordering pulls sorted rows directly from a LEFT JOIN to
    // trust_scores so it's correct at query time, not relying on the in-app
    // TODO fallback. Other sorts keep their existing behaviour.
    let orderBy: SQL;
    if (q.sort === "cheapest") orderBy = asc(propertiesTable.rent_amount_ngn);
    else if (q.sort === "most_trusted") {
      orderBy = sql`COALESCE(${trustScoresTable.total_score}, ${TRUST_BASELINE}) DESC, ${propertiesTable.created_at} DESC`;
    } else {
      orderBy = desc(propertiesTable.created_at);
    }

    const page = q.page ?? 1;
    const pageSize = q.page_size ?? 12;
    const offset = (page - 1) * pageSize;

    // If we're sorting by trust we need the join in the main query; otherwise
    // we keep the original simple query for clarity and performance.
    const baseWhere = filters.length > 1 ? and(...filters) : filters[0]!;

    // ── Round-trip consolidation ─────────────────────────────────────────────
    //
    // This endpoint used to issue 5+ sequential queries against Supabase's
    // transaction pooler: main page + COUNT + photos + landlords + trust.
    // On a cold Vercel serverless invocation the per-round-trip overhead
    // added up to ~17s, exceeding the 10s function timeout and producing a
    // 504 that the UI surfaces as "Couldn't load listings." Warm requests
    // (~3.5s) survived because they avoided the cold-start connect cost,
    // which is why the bug only showed up in production.
    //
    // We now fetch the property page + landlord summary + trust row in one
    // leftJoin-ed query (the same shape `most_trusted` already used), then
    // fetch only the hero photos in one bounded query. That cuts the normal
    // path from 5 sequential database operations to 3 total operations
    // (page + count run concurrently, then the photo lookup), while keeping
    // the response shape exactly the same.
    //
    // Trust ordering is unchanged: when `sort === "most_trusted"` the
    // join also drives the ORDER BY; for other sorts we still leftJoin but
    // ignore trust in the ORDER BY. Either way we return the trust data so
    // the card can render the score.
    const pageQuery = db
      .select({
        prop: propertiesTable,
        landlord: {
          id: usersTable.id,
          first_name: usersTable.first_name,
          last_name: usersTable.last_name,
          role: usersTable.role,
          verification_status: usersTable.verification_status,
        },
        trust: trustScoresTable,
        // Fold the hero photo into the same round-trip as a correlated
        // subquery (LATERAL-free, runs against the outer `properties` row).
        // This removes the second DB round-trip the Supabase pooler makes
        // painfully slow — the listings route now does ONE query for the page
        // (plus the count), instead of page → wait → photos.
        hero_photo_url: sql<string | null>`
          (
            SELECT photo_url
            FROM property_photos
            WHERE property_id = ${propertiesTable.id}
            ORDER BY photo_order ASC
            LIMIT 1
          )
        `.as("hero_photo_url"),
      })
      .from(propertiesTable)
      .leftJoin(usersTable, eq(usersTable.id, propertiesTable.landlord_id))
      .leftJoin(trustScoresTable, eq(trustScoresTable.user_id, propertiesTable.landlord_id))
      .where(baseWhere)
      .orderBy(orderBy)
      .limit(pageSize)
      .offset(offset);

    const totalQuery = db
      .select({ count: sql<number>`count(*)::int` })
      .from(propertiesTable)
      .where(baseWhere);

    const [pageRows, totalResult] = await Promise.all([pageQuery, totalQuery]);
    const rows = pageRows.map((r) => r.prop);
    const totalRows = totalResult;

    const total = totalRows[0]?.count ?? 0;

    // Hero photo per property — single correlated subquery so we don't issue
    // another round-trip and don't join the whole photos table. Returns the
    // lowest-photo_order row for each property (hero), or NULL when the
    // listing has no photos uploaded.
    //
    // Built with raw SQL for the subquery body (rather than the property_photos
    // table builder) so Drizzle doesn't try to validate the photos columns
    // against the OUTER query's FROM list — which would reject the subquery
    // with "table property_photos is not part of the query".
    // Hero photos are now fetched inline as `hero_photo_url` on each row (see
    // pageQuery above), so there's no second round-trip to wait for. The
    // `inArray`/`ids` bookkeeping below was the old path.
    void rows;

    const data: PropertySummary[] = pageRows.map((row) => {
      const p = row.prop;
      const l = row.landlord;
      const ts = row.trust;
      const hero = row.hero_photo_url ?? null;
      // Drizzle's leftJoin keeps the joined object present with null columns
      // when there's no match. Treat that as "no landlord" so the response
      // shape matches the previous behaviour (`landlord: undefined` instead of
      // `landlord: { id: null, ... }`).
      const hasLandlord = l && l.id != null;
      return {
        id: p.id,
        address: p.address,
        rent_amount_ngn: p.rent_amount_ngn,
        deposit_amount_ngn: p.deposit_amount_ngn,
        rooms: p.rooms ?? 1,
        listing_status: p.listing_status ?? "draft",
        hero_photo_url: hero,
        amenities: p.amenities ?? {},
        created_at: p.created_at?.toISOString() ?? null,
        landlord: hasLandlord ? {
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
    logger.info("api.properties.GET completed", {
      duration_ms: Date.now() - startedAt,
      total,
      returned: data.length,
    });
    return jsonResponse(response);
  } catch (err) {
    const e = err as Error & { code?: string; cause?: unknown };
    logger.error("api.properties.GET failed", {
      duration_ms: Date.now() - startedAt,
      message: e?.message ?? String(err),
      code: e?.code,
      cause: e?.cause instanceof Error ? e.cause.message : e?.cause,
    });
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
          // Auto-publish: a freshly created listing is immediately live so it
          // shows up on the landing page and in search. (The officer-review
          // gate can be added later if needed; right now the trust control is
          // KYC verification on the landlord, not per-listing approval.)
          listing_status: "live",
          published_at: new Date(),
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