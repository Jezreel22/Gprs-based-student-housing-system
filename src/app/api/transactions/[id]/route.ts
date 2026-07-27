import { NextRequest } from "next/server";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { errorResponse, handleError, jsonResponse } from "@/lib/api";
import { auditLogTable, bookingsTable, propertiesTable, usersTable } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { canViewTransaction } from "@/lib/escrow-transactions/access";
import { loadTransactionDetail } from "@/lib/escrow-transactions/repository";
import { writeAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * GET /api/transactions/[id]
 *
 * Authorised transaction detail with booking, parties, property, the
 * immutable receipt snapshot, and a participant-appropriate audit timeline.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(req);
    if (user.role === "agent") return errorResponse("Forbidden", 403);

    const { id } = await params;
    const allowed = await canViewTransaction(user, id);
    if (!allowed) return errorResponse("Not found", 404);

    const detail = await loadTransactionDetail(id);
    if (!detail) return errorResponse("Not found", 404);

    // Audit timeline: pull the last N entries for the booking + the receipt
    // generation row.
    const resourceIds = [detail.booking?.id, detail.transaction.id, detail.receipt?.id].filter(
      (x): x is string => Boolean(x),
    );
    const auditRows = await db
      .select()
      .from(auditLogTable)
      .where(
        resourceIds.length
          ? inArray(auditLogTable.resource_id, resourceIds)
          : eq(auditLogTable.resource_id, detail.transaction.id),
      )
      .orderBy(desc(auditLogTable.created_at))
      .limit(50);

    // Hydrate actor display names for the timeline.
    const actorIds = Array.from(new Set(auditRows.map((a) => a.actor_id).filter(Boolean) as string[]));
    const actors = actorIds.length
      ? await db
          .select({ id: usersTable.id, first_name: usersTable.first_name, last_name: usersTable.last_name, role: usersTable.role })
          .from(usersTable)
          .where(inArray(usersTable.id, actorIds))
      : [];
    const actorMap = new Map(actors.map((a) => [a.id, a]));

    // Booking + property insurance hydration for the response.
    const [property] = detail.booking
      ? await db
          .select({
            id: propertiesTable.id,
            address: propertiesTable.address,
          })
          .from(propertiesTable)
          .where(eq(propertiesTable.id, detail.booking.property_id))
          .limit(1)
      : [];

    await writeAudit({
      req,
      actorId: user.id,
      actionType: "transaction_viewed",
      resourceType: "escrow_transaction",
      resourceId: detail.transaction.id,
      details: {
        booking_id: detail.transaction.booking_id,
        receipt_id: detail.receipt?.id ?? null,
      },
    });

    return jsonResponse({
      transaction: detail.transaction,
      receipt: detail.receipt,
      booking: detail.booking,
      property: property ?? null,
      student: detail.student,
      landlord: detail.landlord,
      timeline: auditRows.map((a) => {
        const actor = actorMap.get(a.actor_id);
        return {
          id: a.id,
          action_type: a.action_type,
          actor_name: actor ? `${actor.first_name ?? ""} ${actor.last_name ?? ""}`.trim() : null,
          actor_role: actor?.role ?? null,
          details: a.details,
          ip_address: a.ip_address,
          user_agent: a.user_agent,
          created_at: a.created_at,
        };
      }),
    });
  } catch (err) {
    return handleError(err, req);
  }
}

void bookingsTable;
void and;