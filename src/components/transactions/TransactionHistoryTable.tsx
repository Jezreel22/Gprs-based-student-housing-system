"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@/api/custom-fetch";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia } from "@/components/ui/empty";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { ChevronLeft, Search, FileSearch, Wallet, RefreshCcw } from "lucide-react";
import Link from "next/link";

export interface TransactionRow {
  id: string;
  transaction_type: "deposit" | "release" | "refund";
  transaction_status: "pending" | "succeeded" | "failed" | "reversed" | "manual_review";
  amount_ngn: number;
  currency: string;
  payment_method: string;
  gateway_reference: string | null;
  gateway_transfer_code: string | null;
  created_at: string;
  confirmed_at: string | null;
  booking_id: string;
  booking_reference: string | null;
  student_id: string;
  student_name: string | null;
  landlord_id: string;
  landlord_name: string | null;
  property_address: string | null;
  receipt: {
    id: string;
    receipt_number: string;
    receipt_kind: "deposit" | "release" | "refund";
    verification_token: string;
    issued_at: string;
  } | null;
}

export interface TransactionsResponse {
  items: TransactionRow[];
  total: number;
  page: number;
  page_size: number;
}

const KIND_COLOR: Record<string, { bg: string; fg: string; label: string }> = {
  deposit: { bg: "#DBEAFE", fg: "#1D4ED8", label: "Deposit" },
  release: { bg: "#DCFCE7", fg: "#15803D", label: "Release" },
  refund:  { bg: "#FEF3C7", fg: "#B45309", label: "Refund" },
};
const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  succeeded:    { bg: "#DCFCE7", fg: "#15803D" },
  pending:      { bg: "#FEF3C7", fg: "#B45309" },
  manual_review:{ bg: "#FEF3C7", fg: "#B45309" },
  failed:       { bg: "#FEE2E2", fg: "#B91C1C" },
  reversed:     { bg: "#FEE2E2", fg: "#B91C1C" },
};

function formatNGN(n: number) {
  return `₦${n.toLocaleString("en-NG")}`;
}
function formatDate(iso: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }); } catch { return iso; }
}

export function TransactionHistoryTable({ adminMode = false }: { adminMode?: boolean }) {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [kind, setKind] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Reset to page 1 when filters change.
  useEffect(() => { setPage(1); }, [kind, status, debouncedQ]);

  const qs = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("page", String(page));
    sp.set("page_size", String(pageSize));
    if (kind) sp.set("kind", kind);
    if (status) sp.set("status", status);
    if (debouncedQ) sp.set("q", debouncedQ);
    sp.set("sort", "created_at");
    sp.set("order", "desc");
    return sp.toString();
  }, [page, pageSize, kind, status, debouncedQ]);

  const { data, isLoading, isError, error, refetch } = useQuery<TransactionsResponse>({
    queryKey: ["transactions", qs, adminMode],
    queryFn: () => customFetch<TransactionsResponse>(`/api/transactions?${qs}`),
    staleTime: 5_000,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-card rounded-2xl border border-[#EBEBEB] dark:border-border p-4 flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by receipt number, property, or participant…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={kind} onValueChange={(v) => setKind(v === "all" ? "" : v)}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="All kinds" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            <SelectItem value="deposit">Deposit</SelectItem>
            <SelectItem value="release">Release</SelectItem>
            <SelectItem value="refund">Refund</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="All statuses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="succeeded">Succeeded</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="manual_review">Manual review</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="reversed">Reversed</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={() => refetch()} aria-label="Refresh">
          <RefreshCcw className="h-4 w-4" />
        </Button>
      </div>

      <div className="bg-white dark:bg-card rounded-2xl border border-[#EBEBEB] dark:border-border overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="p-6 border border-red-200 bg-red-50 text-red-700 rounded-md">
            Failed to load transactions: {(error as any)?.message ?? "Unknown error"}.
            <Button variant="link" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : items.length === 0 ? (
          <Empty>
            <EmptyMedia>
              <Wallet className="h-10 w-10 text-muted-foreground" />
            </EmptyMedia>
            <EmptyTitle>No transactions yet</EmptyTitle>
            <EmptyDescription>
              When money moves through escrow — deposits, releases, or refunds — official receipts appear here.
            </EmptyDescription>
            <EmptyContent>
              <Button variant="outline" onClick={() => refetch()}>
                <RefreshCcw className="h-4 w-4 mr-2" /> Refresh
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Property</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((t) => {
                const kindMeta = KIND_COLOR[t.transaction_type] ?? { bg: "#E5E7EB", fg: "#374151", label: t.transaction_type };
                const statusMeta = STATUS_COLOR[t.transaction_status] ?? { bg: "#E5E7EB", fg: "#374151" };
                return (
                  <TableRow key={t.id}>
                    <TableCell>
                      <div className="font-mono text-xs">
                        {t.receipt?.receipt_number ?? <span className="text-muted-foreground">pending</span>}
                      </div>
                      {t.receipt && (
                        <Link
                          className="text-xs text-muted-foreground underline underline-offset-2 inline-flex items-center gap-1 mt-0.5"
                          href={`/verify/receipt/${t.receipt.verification_token}`}
                          target="_blank"
                        >
                          <FileSearch className="h-3 w-3" /> verify
                        </Link>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className="border-0 font-medium" style={{ background: kindMeta.bg, color: kindMeta.fg }}>
                        {kindMeta.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-semibold">{formatNGN(t.amount_ngn)}</TableCell>
                    <TableCell>
                      <Badge className="border-0 font-medium capitalize" style={{ background: statusMeta.bg, color: statusMeta.fg }}>
                        {t.transaction_status.replace(/_/g, " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate text-sm">
                      {t.property_address ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(t.receipt?.issued_at ?? t.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/transactions/${t.id}`}>
                          <ChevronLeft className="h-4 w-4 mr-1 rotate-180" /> Open
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {total > pageSize && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious onClick={() => setPage((p) => Math.max(1, p - 1))} />
            </PaginationItem>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const targetPage = i + 1;
              return (
                <PaginationItem key={targetPage}>
                  <PaginationLink isActive={page === targetPage} onClick={() => setPage(targetPage)}>
                    {targetPage}
                  </PaginationLink>
                </PaginationItem>
              );
            })}
            <PaginationItem>
              <PaginationNext onClick={() => setPage((p) => Math.min(totalPages, p + 1))} />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}

      <div className="text-xs text-muted-foreground text-center">
        Showing {items.length} of {total} transactions
      </div>
    </div>
  );
}