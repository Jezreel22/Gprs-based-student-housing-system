"use client";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Wallet, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { colorFor, formatDateOnly, formatNGN, labelFor } from "./status";
import type { EscrowLedgerItem } from "./useEscrowBookings";

export type SortKey = "updated_at" | "created_at" | "total_amount_ngn" | "status";
export type SortOrder = "asc" | "desc";

interface Props {
  items: EscrowLedgerItem[];
  loading: boolean;
  error: Error | null;
  sort: SortKey;
  order: SortOrder;
  onSortChange: (sort: SortKey, order: SortOrder) => void;
  onRowClick: (item: EscrowLedgerItem) => void;
  selectedId?: string | null;
}

export function EscrowLedgerTable({
  items, loading, error, sort, order, onSortChange, onRowClick, selectedId,
}: Props) {
  if (loading && items.length === 0) {
    return <TableSkeleton />;
  }
  if (error) {
    return (
      <div className="bg-white rounded-2xl border border-[#EBEBEB] p-8 text-center">
        <p className="text-sm text-red-600">Failed to load escrow ledger: {error.message}</p>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-[#EBEBEB]">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Wallet className="h-6 w-6 text-blue-500 opacity-60" />
            </EmptyMedia>
            <EmptyTitle>No escrow transactions match these filters</EmptyTitle>
            <EmptyDescription>Try clearing the search or selecting a different stage.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => onSortChange("updated_at", "desc")}>Reset filters</Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-[#EBEBEB] overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-[#FAFAFA]">
            <TableHead className="font-semibold">Transaction</TableHead>
            <TableHead className="font-semibold">Property</TableHead>
            <TableHead className="font-semibold">Tenant</TableHead>
            <TableHead className="font-semibold">Landlord</TableHead>
            <SortableHead label="Amount" sortKey="total_amount_ngn" sort={sort} order={order} onSortChange={onSortChange} align="right" />
            <TableHead className="font-semibold">Stage</TableHead>
            <TableHead className="font-semibold">Disbursement</TableHead>
            <SortableHead label="Updated" sortKey="updated_at" sort={sort} order={order} onSortChange={onSortChange} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((b) => {
            const c = colorFor(b.stage);
            const isSelected = b.id === selectedId;
            return (
              <TableRow
                key={b.id}
                onClick={() => onRowClick(b)}
                className={`cursor-pointer hover:bg-[#FAFAFA] ${isSelected ? "bg-blue-50/50" : ""}`}
                data-state={isSelected ? "selected" : undefined}
              >
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {(b.payment_transaction_id ?? b.id).slice(0, 16)}…
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2 min-w-0">
                    {b.property_thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={b.property_thumbnail_url} alt="" className="h-9 w-9 rounded-md object-cover border border-[#EBEBEB] shrink-0" />
                    ) : (
                      <div className="h-9 w-9 rounded-md bg-[#F3F4F6] border border-[#EBEBEB] shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate max-w-[220px]">{b.property_address ?? "—"}</div>
                      {b.occupancy_code && (
                        <div className="text-[10px] text-muted-foreground font-mono">Code · {b.occupancy_code}</div>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="text-sm">{b.student_name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">{b.student_verification ?? ""}</div>
                </TableCell>
                <TableCell>
                  <div className="text-sm">{b.landlord_name ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">{b.landlord_verification ?? ""}</div>
                </TableCell>
                <TableCell className="text-right font-medium">{formatNGN(b.total_amount_ngn)}</TableCell>
                <TableCell>
                  <Badge className="border-0 font-medium" style={{ background: c.bg, color: c.fg }}>
                    {b.stage_label ?? labelFor(b.stage)}
                  </Badge>
                </TableCell>
                <TableCell>
                  {b.payout_transfer_reference ? (
                    <div className="text-xs">
                      <div className="font-mono text-[10px] truncate max-w-[140px]">{b.payout_transfer_reference}</div>
                      <div className="text-muted-foreground">{b.payout_attempts} attempt{b.payout_attempts === 1 ? "" : "s"}</div>
                    </div>
                  ) : b.payout_error ? (
                    <div className="text-xs text-red-600 truncate max-w-[180px]">{b.payout_error}</div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatDateOnly(b.updated_at)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function SortableHead({
  label, sortKey, sort, order, onSortChange, align,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortKey;
  order: SortOrder;
  onSortChange: (sort: SortKey, order: SortOrder) => void;
  align?: "right";
}) {
  const active = sort === sortKey;
  return (
    <TableHead className={`font-semibold ${align === "right" ? "text-right" : ""}`}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => onSortChange(sortKey, active && order === "desc" ? "asc" : "desc")}
      >
        {label}
        {active ? (order === "desc" ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />) : null}
      </button>
    </TableHead>
  );
}

function TableSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-[#EBEBEB] p-4 space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
