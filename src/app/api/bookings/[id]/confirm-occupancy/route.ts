import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bookingsTable, propertiesTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse, errorResponse } from "@/lib/api";

const ConfirmBody = z.object({
  occupancy_code: z.string().min(6).max(6),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireAuth(req);
    const { id } = await params;

    const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    if (!booking) return errorResponse("Booking not found", 404);
    if (booking.student_id !== me.id) return errorResponse("Only the student can confirm occupancy", 403);
    if (booking.booking_status !== "pending_occupancy") {
      return errorResponse(`Cannot confirm occupancy from status "${booking.booking_status}"`, 409);
    }

    // The 6-character occupancy code lives on the property, not the booking.
    const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, booking.property_id)).limit(1);
    if (!property) return errorResponse("Property for this booking no longer exists", 404);

    const body = await parseBody(req, ConfirmBody);
    if (body.occupancy_code.toUpperCase() !== property.occupancy_code) {
      return errorResponse("Invalid occupancy code", 400);
    }

    await db.update(bookingsTable)
      .set({
        occupancy_code_entered: body.occupancy_code.toUpperCase(),
        occupancy_gps_latitude: body.latitude ?? null,
        occupancy_gps_longitude: body.longitude ?? null,
        occupancy_confirmed_by_student_at: new Date(),
        occupancy_verified_at: new Date(),
        occupancy_attempts: (booking.occupancy_attempts ?? 0) + 1,
        booking_status: "pending_review",
        updated_at: new Date(),
      })
      .where(eq(bookingsTable.id, id));

    const [updated] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id)).limit(1);
    return jsonResponse(updated);
  } catch (err) {
    return handleError(err, req);
  }
}