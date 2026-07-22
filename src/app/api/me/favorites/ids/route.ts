import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { propertyFavoritesTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse } from "@/lib/api";

/**
 * GET /api/me/favorites/ids — just the property IDs the calling user has
 * saved. Used by listing cards / detail pages to render the heart state
 * without an N+1 query per card. Cheap: one column, indexed by user_id.
 */
export async function GET(req: NextRequest) {
  try {
    const me = await requireAuth(req);
    const rows = await db
      .select({ property_id: propertyFavoritesTable.property_id })
      .from(propertyFavoritesTable)
      .where(eq(propertyFavoritesTable.user_id, me.id));
    return jsonResponse({ data: rows.map((r) => r.property_id) });
  } catch (err) {
    return handleError(err, req);
  }
}
