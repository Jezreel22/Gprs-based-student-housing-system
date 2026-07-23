"use client";

import { Wallet, ShieldAlert, Package, CheckCircle2, XCircle } from "lucide-react";
import type { EscrowLedgerTotals } from "./useEscrowBookings";
import { formatNGN } from "./status";

interface Props {
  totals: EscrowLedgerTotals | undefined;
}

/**
 * Five summary tiles for the top of the admin escrow ledger.
 *
 * Order chosen to mirror the lifecycle visually: held (money in custody) →
 * under verification → verified → ready for disbursement → completed →
 * rejected. The tiles update via react-query polling — no manual refetch.
 */
export function EscrowSummaryCards({ totals }: Props) {
  const t: EscrowLedgerTotals = totals ?? {
    payment_received: 0,
    under_verification: 0,
    verified: 0,
    ready_for_disbursement: 0,
    disbursement_failed: 0,
    rejected: 0,
    disbursed: 0,
    held_balance_ngn: 0,
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      <Tile
        icon={<Wallet className="h-5 w-5" />}
        accent="#1D4ED8"
        bg="#DBEAFE"
        label="Held in escrow"
        primary={formatNGN(t.held_balance_ngn)}
        secondary={`${t.payment_received + t.under_verification + t.verified + t.ready_for_disbursement} bookings`}
      />
      <Tile
        icon={<ShieldAlert className="h-5 w-5" />}
        accent="#B45309"
        bg="#FEF3C7"
        label="Under verification"
        primary={String(t.under_verification)}
        secondary={`${t.payment_received} received`}
      />
      <Tile
        icon={<CheckCircle2 className="h-5 w-5" />}
        accent="#4338CA"
        bg="#E0E7FF"
        label="Verified · Ready"
        primary={`${t.verified}/${t.ready_for_disbursement}`}
        secondary="verified · ready"
      />
      <Tile
        icon={<Package className="h-5 w-5" />}
        accent="#15803D"
        bg="#DCFCE7"
        label="Disbursed"
        primary={String(t.disbursed)}
        secondary={`${t.disbursement_failed} failed`}
      />
      <Tile
        icon={<XCircle className="h-5 w-5" />}
        accent="#B91C1C"
        bg="#FEE2E2"
        label="Rejected"
        primary={String(t.rejected)}
        secondary="all-time"
      />
    </div>
  );
}

function Tile({
  icon,
  accent,
  bg,
  label,
  primary,
  secondary,
}: {
  icon: React.ReactNode;
  accent: string;
  bg: string;
  label: string;
  primary: string;
  secondary: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#EBEBEB] p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="h-9 w-9 rounded-lg flex items-center justify-center" style={{ background: bg, color: accent }}>
          {icon}
        </div>
        <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{label}</div>
      </div>
      <div className="text-2xl font-bold" style={{ color: accent }}>{primary}</div>
      <div className="text-xs text-muted-foreground mt-1">{secondary}</div>
    </div>
  );
}
