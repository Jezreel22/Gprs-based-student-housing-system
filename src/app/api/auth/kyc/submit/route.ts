import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { usersTable, auditLogTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse } from "@/lib/api";
import { createNotification } from "@/lib/notify";

const KycSubmitSchema = z.object({
  national_id_type: z.enum(["nin", "international_passport", "drivers_licence"]),
  national_id_document_url: z.string().min(1),
  selfie_url: z.string().min(1),
  property_document_url: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req);
    if (!["landlord", "agent"].includes(user.role)) {
      return jsonResponse({ error: "Only landlords and agents can submit KYC" }, { status: 403 });
    }

    const body = await parseBody(req, KycSubmitSchema);

    // Auto-verify on submit — consistent with student auto-verification and
    // auto-published listings. The document + selfie are captured for the audit
    // trail; an escrow officer can still suspend the account later if needed.
    const now = new Date();
    await db.update(usersTable)
      .set({
        national_id_type: body.national_id_type,
        national_id_document_url: body.national_id_document_url,
        national_id_verified_at: now,
        selfie_url: body.selfie_url,
        selfie_verified_at: now,
        property_document_url: body.property_document_url ?? null,
        kyc_submitted_at: now,
        verification_status: "verified",
        updated_at: now,
      })
      .where(eq(usersTable.id, user.id));

    await db.insert(auditLogTable).values({
      actor_id: user.id,
      action_type: "kyc_verified",
      resource_type: "user",
      resource_id: user.id,
    });

    await createNotification({
      userId: user.id,
      type: "system",
      title: "You're verified ✅",
      body: "Your identity is verified. You can now list properties and receive bookings.",
    });

    return jsonResponse({ message: "Identity verified", status: "verified" });
  } catch (err) {
    return handleError(err, req);
  }
}