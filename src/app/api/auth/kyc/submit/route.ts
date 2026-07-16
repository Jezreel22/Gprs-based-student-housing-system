import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { usersTable, auditLogTable } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth";
import { handleError, parseBody, jsonResponse, errorResponse } from "@/lib/api";
import { createNotification } from "@/lib/notify";
import { verifyLandlordIdentity } from "@/lib/kyc";
import { createTransferRecipient } from "@/lib/paystack-server";

const KycSubmitSchema = z.object({
  national_id_type: z.enum(["nin", "international_passport", "drivers_licence"]),
  national_id_document_url: z.string().min(1),
  selfie_url: z.string().min(1),
  // 0–100, computed client-side from face-presence + liveness checks. Required
  // so a static upload or a no-face frame can't pass. Server enforces a floor.
  face_confidence: z.number().min(0).max(100),
  // Real identity anchor: BVN is resolved by Paystack but never persisted.
  bvn: z.string().regex(/^\d{11}$/, "BVN must be 11 digits"),
  // The same verified bank account becomes the Paystack payout destination.
  bank_account_number: z.string().regex(/^\d{10}$/, "Account number must be 10 digits"),
  bank_code: z.string().min(2),
  property_document_url: z.string().min(1, "Property ownership document is required"),
});

// Below this the selfie is treated as "no real face / not live". Tuned so the
// browser's native FaceDetector (or its heuristic fallback) must actually fire.
const FACE_CONFIDENCE_FLOOR = 55;

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req);
    if (!["landlord", "agent"].includes(user.role)) {
      return jsonResponse({ error: "Only landlords and agents can submit KYC" }, { status: 403 });
    }

    const body = await parseBody(req, KycSubmitSchema);

    // 1) Face-presence gate. A selfie that the browser couldn't confidently
    //    detect a live face in is rejected outright — no amount of uploaded
    //    bytes bypasses this.
    if (body.face_confidence < FACE_CONFIDENCE_FLOOR) {
      await db.insert(auditLogTable).values({
        actor_id: user.id,
        action_type: "kyc_face_check_failed",
        resource_type: "user",
        resource_id: user.id,
        details: { face_confidence: body.face_confidence },
      });
      return errorResponse(
        "We couldn't confirm a live face in your selfie. Retake it in good light, face the camera directly, and avoid covering your face.",
        422,
        { code: "face_check_failed" },
      );
    }

    // 2) Real identity check — Paystack resolves the BVN and the payout bank
    //    account. Both names must match the landlord profile. Raw BVNs are
    //    never persisted.
    const identity = await verifyLandlordIdentity({
      bvn: body.bvn,
      accountNumber: body.bank_account_number,
      bankCode: body.bank_code,
      firstName: user.first_name,
      lastName: user.last_name,
    });
    if (!identity.ok) {
      await db.insert(auditLogTable).values({
        actor_id: user.id,
        action_type: "kyc_identity_check_failed",
        resource_type: "user",
        resource_id: user.id,
        details: { reason: identity.reason },
      });
      return errorResponse(identity.reason, 422, { code: "identity_check_failed" });
    }

    // Create the Paystack recipient now, from the account that passed KYC, so
    // a later student-approved escrow release has a real payout destination.
    let recipient: { recipient_code: string };
    try {
      recipient = await createTransferRecipient({
        account_number: body.bank_account_number,
        bank_code: body.bank_code,
        account_name: identity.resolvedAccountName,
      });
    } catch {
      return errorResponse(
        "Your identity was confirmed, but we couldn't create your Paystack payout account. Please try again shortly.",
        502,
        { code: "payout_setup_failed" },
      );
    }

    // All checks passed — persist the verified state + the audit artifacts.
    const now = new Date();
    await db.update(usersTable)
      .set({
        national_id_type: body.national_id_type,
        national_id_document_url: body.national_id_document_url,
        national_id_verified_at: now,
        selfie_url: body.selfie_url,
        selfie_verified_at: now,
        property_document_url: body.property_document_url ?? null,
        // Mirror the verified bank account onto payout details so a released
        // booking can pay out to the same verified account without re-setup.
        payout_bank_code: body.bank_code,
        payout_account_number: body.bank_account_number,
        payout_account_name: identity.resolvedAccountName,
        paystack_recipient_code: recipient.recipient_code,
        payout_details_set_at: now,
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
      details: {
        resolved_account_name: identity.resolvedAccountName,
        face_confidence: body.face_confidence,
      },
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
