import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { propertyFavoritesTable, propertiesTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse, errorResponse } from "@/lib/api";

/**
 * POST /api/properties/:id/favorite — add the calling user's heart on a property.
 * DELETE /api/properties/:id/favorite — remove it.
 *
 * Idempotent: POSTing when already favorited is a no-op (returns isFavorite: true);
 * DELETE-ing when not favorited is likewise a no-op. Returns whether the property
 * is currently favorited by the caller plus the total favorite count.
 */
async function propertyExists(id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: propertiesTable.id })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, id))
    .limit(1);
  return !!row;
}

async function countFavorites(propertyId: string): Promise<number> {
  const rows = await db
    .select({ id: propertyFavoritesTable.id })
    .from(propertyFavoritesTable)
    .where(eq(propertyFavoritesTable.property_id, propertyId));
  return rows.length;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireAuth(req);
    const { id } = await params;
    if (!(await propertyExists(id))) return errorResponse("Property not found", 404);

    // Insert ignore — if the (user_id, property_id) row already exists the
    // unique index rejects it and we treat that as "already favorited".
    await db
      .insert(propertyFavoritesTable)
      .values({ user_id: me.id, property_id: id })
      .onConflictDoNothing({
        target: [propertyFavoritesTable.user_id, propertyFavoritesTable.property_id],
      });

    return jsonResponse({
      isFavorite: true,
      favoriteCount: await countFavorites(id),
    });
  } catch (err) {
    return handleError(err, req);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireAuth(req);
    const { id } = await params;
    if (!(await propertyExists(id))) return errorResponse("Property not found", 404);

    await db
      .delete(propertyFavoritesTable)
      .where(
        and(
          eq(propertyFavoritesTable.user_id, me.id),
          eq(propertyFavoritesTable.property_id, id),
        ),
      );

    return jsonResponse({
      isFavorite: false,
      favoriteCount: await countFavorites(id),
    });
  } catch (err) {
    return handleError(err, req);
  }
}
