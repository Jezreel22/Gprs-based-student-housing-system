"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { ShieldCheck, ShieldAlert, Loader2, ArrowLeft, Search, X } from "lucide-react";
import NavBar from "@/components/NavBar";
import { EscrowSummaryCards } from "./EscrowSummaryCards";
import { EscrowLedgerTable, type SortKey, type SortOrder } from "./EscrowLedgerTable";
import { EscrowDetailDrawer } from "./EscrowDetailDrawer";
import { useEscrowBookings, type EscrowLedgerItem } from "./useEscrowBookings";

const STAGE_FILTER_OPTIONS = [
  { value: "__all__", label: "All in-flight" },
  { value: "payment_received", label: "Payment received" },
  { value: "under_verification", label: "Under verification" },
  { value: "verified", label: "Verified" },
  { value: "ready_for_disbursement", label: "Ready for disbursement" },
  { value: "disbursement_failed", label: "Disbursement failed" },
  { value: "rejected", label: "Rejected" },
  { value: "disbursed", label: "Disbursed (historical)" },
  { value: "payment_pending", label: "Payment pending" },
];

export default function AdminEscrowLedgerPage() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);

  // Filters
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [status, setStatus] = useState<string>("");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sort, setSort] = useState<SortKey>("updated_at");
  const [order, setOrder] = useState<SortOrder>("desc");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Debounce free-text search — don't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => { setPage(1); }, [debouncedQ, status]);

  // Role gate — mirror /admin/page.tsx exactly.
  useEffect(() => {
    const token = localStorage.getItem("naub_token");
    const raw = localStorage.getItem("naub_user");
    if (!token || !raw) { router.push("/login"); return; }
    let user: { role?: string } | null = null;
    try { user = JSON.parse(raw); } catch {
      localStorage.removeItem("naub_token");
      localStorage.removeItem("naub_user");
    }
    if (!user) { router.push("/login"); return; }
    setAllowed(user.role === "escrow_officer");
    setChecked(true);
  }, [router]);

  const query = useEscrowBookings({
    page, pageSize,
    status: status || undefined,
    q: debouncedQ || undefined,
    sort, order,
    enabled: allowed,
  });

  const items: EscrowLedgerItem[] = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function handleSortChange(s: SortKey, o: SortOrder) {
    setSort(s); setOrder(o);
  }

  function clearFilters() {
    setStatus(""); setQ(""); setDebouncedQ("");
  }

  if (!checked) {
    return (
      <div className="min-h-screen bg-[#F7F7F7]">
        <NavBar />
        <div className="max-w-6xl mx-auto px-4 py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="min-h-screen bg-[#F7F7F7]">
        <NavBar />
        <div className="max-w-xl mx-auto px-4 py-16 text-center">
          <ShieldAlert className="h-12 w-12 mx-auto mb-3 text-amber-500 opacity-80" />
          <h1 className="text-2xl font-bold mb-2">Admin only</h1>
          <p className="text-muted-foreground mb-6">This area is for escrow officers.</p>
          <Link href="/dashboard">
            <Button style={{ background: "#FF5A5F", color: "#fff", border: "none" }}>Back to dashboard</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F7F7]">
      <NavBar />

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link href="/admin" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                <ArrowLeft className="h-3 w-3" />
                Back to admin overview
              </Link>
            </div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-primary" />
              Escrow Management
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Review every escrow transaction end-to-end. All actions are recorded in the immutable audit trail.
            </p>
          </div>
          <div className="text-xs text-muted-foreground text-right">
            <div>Polling every 10s while this page is visible.</div>
            <div>Last refreshed {new Date().toLocaleTimeString()}</div>
          </div>
        </div>

        <div className="mb-6">
          <EscrowSummaryCards totals={query.data?.totals} />
        </div>

        {/* Filters bar */}
        <div className="bg-white rounded-2xl border border-[#EBEBEB] p-4 mb-4 grid grid-cols-1 md:grid-cols-[200px_1fr_auto_auto] gap-3 items-end">
          <div>
            <div className="text-xs font-medium mb-1.5">Stage</div>
            <Select value={status || "__all__"} onValueChange={(v) => setStatus(v === "__all__" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STAGE_FILTER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="relative">
            <div className="text-xs font-medium mb-1.5">Search (address, names)</div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by property address or participant name…"
                className="pl-9"
              />
            </div>
          </div>
          <div>
            <div className="text-xs font-medium mb-1.5">Sort by</div>
            <Select value={`${sort}:${order}`} onValueChange={(v) => {
              const [s, o] = v.split(":") as [SortKey, SortOrder];
              setSort(s); setOrder(o);
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="updated_at:desc">Recently updated</SelectItem>
                <SelectItem value="updated_at:asc">Oldest update</SelectItem>
                <SelectItem value="created_at:desc">Newest booking</SelectItem>
                <SelectItem value="created_at:asc">Oldest booking</SelectItem>
                <SelectItem value="total_amount_ngn:desc">Amount · high → low</SelectItem>
                <SelectItem value="total_amount_ngn:asc">Amount · low → high</SelectItem>
                <SelectItem value="status:asc">Status · A→Z</SelectItem>
                <SelectItem value="status:desc">Status · Z→A</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={clearFilters} disabled={!q && !status}>
            <X className="h-4 w-4 mr-1.5" /> Clear
          </Button>
        </div>

        <EscrowLedgerTable
          items={items}
          loading={query.isLoading}
          error={query.error as Error | null}
          sort={sort}
          order={order}
          onSortChange={handleSortChange}
          onRowClick={(b) => setSelectedId(b.id)}
          selectedId={selectedId}
        />

        {/* Pagination */}
        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Page {page} of {totalPages} · {total} total
          </div>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  onClick={(e) => { e.preventDefault(); if (page > 1) setPage(page - 1); }}
                  aria-disabled={page <= 1}
                  className={page <= 1 ? "pointer-events-none opacity-50" : ""}
                />
              </PaginationItem>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map((p) => (
                <PaginationItem key={p}>
                  <PaginationLink
                    href="#"
                    onClick={(e) => { e.preventDefault(); setPage(p); }}
                    isActive={p === page}
                  >
                    {p}
                  </PaginationLink>
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext
                  href="#"
                  onClick={(e) => { e.preventDefault(); if (page < totalPages) setPage(page + 1); }}
                  aria-disabled={page >= totalPages}
                  className={page >= totalPages ? "pointer-events-none opacity-50" : ""}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      </div>

      <EscrowDetailDrawer
        bookingId={selectedId}
        onClose={() => setSelectedId(null)}
        onMutated={() => query.refetch()}
      />
    </div>
  );
}
