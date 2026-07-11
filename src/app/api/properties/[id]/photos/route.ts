import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { propertiesTable, propertyPhotosTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse, errorResponse } from "@/lib/api";

const AddPhotosBody = z.object({
  photos: z.array(z.object({
    photo_url: z.string().min(1),
    photo_order: z.number().int().nonnegative().optional(),
  })).min(1),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireAuth(req);
    const { id } = await params;

    const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, id)).limit(1);
    if (!property) return errorResponse("Property not found", 404);
    if (property.landlord_id !== me.id) return errorResponse("Not your listing", 403);

    const body = await parseBody(req, AddPhotosBody);
    const inserted = await db.insert(propertyPhotosTable).values(
      body.photos.map((p) => ({
        property_id: id,
        photo_url: p.photo_url,
        photo_order: p.photo_order ?? 0,
      })),
    ).returning();

    return jsonResponse({ message: "Photos added", count: inserted.length, photos: inserted }, { status: 201 });
  } catch (err) {
    return handleError(err, req);
  }
}