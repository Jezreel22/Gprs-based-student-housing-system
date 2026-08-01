/**
 * POST /api/admin/properties/[id]/gps-verify
 *
 * Feature 7 (Property GPS Verification). Officer compares the landlord-
 * submitted coordinates against officer-verified coordinates and sets a
 * status.
 *
 *   verified: sets `gps_verification_status='verified'`, stamps
 *             `geolocation_verified_at=now()`, and stores the verified
 *             coords (defaulting to the submitted coords when the officer
 *             doesn't supply new ones).
 *   rejected: sets `gps_verification_status='rejected'` (does NOT touch
 *             `geolocation_verified_at` — a rejection doesn't verify the
 *             pin), with a required `reason ≥ 5 chars`.
 *
 * Audit trail is the source of truth for the rationale on rejection — same
 * shape as the user-KYC reject route (`details: { reason }` inside the
 * jsonb column).
 */

import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { propertiesTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, jsonResponse, parseBody, errorResponse } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

const Body = z
  .object({
    status: z.enum(["verified", "rejected"]),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    reason: z.string().min(5).max(1000).optional(),
  })
  .refine(
    (b) => (b.status === "rejected" ? typeof b.reason === "string" && b.reason.length >= 5 : true),
    {
      message: "A reason of at least 5 characters is required when rejecting GPS verification.",
      path: ["reason"],
    },
  );

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const officer = await requireAuth(req);
    if (officer.role !== "escrow_officer") return errorResponse("Only escrow officers can verify GPS", 403);
    const { id } = await params;
    const body = await parseBody(req, Body);

    const [p] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, id)).limit(1);
    if (!p) return errorResponse("Property not found", 404);

    if (body.status === "verified") {
      // Fall back to the landlord-submitted coords when the officer doesn't
      // supply new ones — the most common case (officer says "yes, these are
      // correct").
      const verifiedLat = body.latitude ?? p.latitude ?? null;
      const verifiedLng = body.longitude ?? p.longitude ?? null;

      await db
        .update(propertiesTable)
        .set({
          gps_verification_status: "verified",
          geolocation_verified_at: new Date(),
          verified_latitude: verifiedLat,
          verified_longitude: verifiedLng,
          updated_at: new Date(),
        })
        .where(eq(propertiesTable.id, id));

      await writeAudit({
        req,
        actorId: officer.id,
        actionType: "property_gps_verified",
        resourceType: "property",
        resourceId: id,
        details: {
          verified_latitude: verifiedLat,
          verified_longitude: verifiedLng,
          submitted_latitude: p.latitude,
          submitted_longitude: p.longitude,
        },
        previousStatus: p.gps_verification_status ?? "pending",
        newStatus: "verified",
      });

      return jsonResponse({
        message: "GPS verification confirmed",
        gps_verification_status: "verified",
        verified_latitude: verifiedLat,
        verified_longitude: verifiedLng,
      });
    }

    // body.status === "rejected" — Zod refine above guarantees reason is present.
    await db
      .update(propertiesTable)
      .set({
        gps_verification_status: "rejected",
        updated_at: new Date(),
      })
      .where(eq(propertiesTable.id, id));

    await writeAudit({
      req,
      actorId: officer.id,
      actionType: "property_gps_rejected",
      resourceType: "property",
      resourceId: id,
      details: { reason: body.reason },
      previousStatus: p.gps_verification_status ?? "pending",
      newStatus: "rejected",
    });

    return jsonResponse({
      message: "GPS verification rejected",
      gps_verification_status: "rejected",
    });
  } catch (err) {
    return handleError(err, req);
  }
}