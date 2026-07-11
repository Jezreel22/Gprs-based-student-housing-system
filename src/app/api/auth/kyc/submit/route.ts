import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { usersTable, auditLogTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse } from "@/lib/api";

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

    await db.update(usersTable)
      .set({
        national_id_type: body.national_id_type,
        national_id_document_url: body.national_id_document_url,
        selfie_url: body.selfie_url,
        property_document_url: body.property_document_url ?? null,
        kyc_submitted_at: new Date(),
        verification_status: "under_review",
        updated_at: new Date(),
      })
      .where(eq(usersTable.id, user.id));

    await db.insert(auditLogTable).values({
      actor_id: user.id,
      action_type: "kyc_submitted",
      resource_type: "user",
      resource_id: user.id,
    });

    return jsonResponse({ message: "KYC documents submitted for review", status: "under_review" });
  } catch (err) {
    return handleError(err, req);
  }
}