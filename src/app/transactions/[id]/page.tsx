"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@/api/custom-fetch";
import NavBar from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, Download, Printer, Share2, FileSearch, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import Link from "next/link";

interface TransactionDetailResponse {
  transaction: any;
  receipt: any;
  booking: any;
  property: any;
  student: any;
  landlord: any;
  timeline: Array<{
    id: string;
    action_type: string;
    actor_name: string | null;
    actor_role: string | null;
    details: any;
    ip_address: string | null;
    user_agent: string | null;
    created_at: string;
  }>;
}

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  succeeded:    { bg: "#DCFCE7", fg: "#15803D" },
  pending:      { bg: "#FEF3C7", fg: "#B45309" },
  manual_review:{ bg: "#FEF3C7", fg: "#B45309" },
  failed:       { bg: "#FEE2E2", fg: "#B91C1C" },
  reversed:     { bg: "#FEE2E2", fg: "#B91C1C" },
};

const KIND_LABELS: Record<string, string> = {
  deposit: "Escrow Deposit",
  release: "Escrow Release",
  refund: "Escrow Refund",
};

function formatNGN(n: number) { return `₦${n.toLocaleString("en-NG")}`; }
function formatDate(iso: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }); } catch { return iso; }
}

export default function TransactionDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const [user, setUser] = useState<any | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem("naub_user");
    if (!raw) { router.push("/login"); return; }
    try { setUser(JSON.parse(raw)); } catch { router.push("/login"); }
  }, [router]);

  const id = params?.id;
  const { data, isLoading, isError } = useQuery<TransactionDetailResponse>({
    queryKey: ["transaction", id],
    queryFn: () => customFetch<TransactionDetailResponse>(`/api/transactions/${id}`),
    enabled: Boolean(id && user),
    staleTime: 5_000,
  });

  if (!user) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <NavBar />
        <div className="max-w-3xl mx-auto px-4 py-8 space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-background">
        <NavBar />
        <div className="max-w-3xl mx-auto px-4 py-8 text-sm text-red-600">
          Transaction not found.
        </div>
      </div>
    );
  }

  const tx = data.transaction;
  const receipt = data.receipt;
  const snap = receipt?.snapshot ?? {};
  const meta = STATUS_COLORS[tx.transaction_status] ?? { bg: "#E5E7EB", fg: "#374151" };

  async function handleDownload() {
    if (!receipt) return;
    window.open(`/api/receipts/${receipt.id}/pdf`, "_blank");
  }
  async function handlePrint() {
    if (!receipt) return;
    window.print();
  }
  async function handleShare() {
    if (!receipt) return;
    try {
      const r = await customFetch<{ verification_url: string }>(`/api/receipts/${receipt.id}/share`, { method: "POST" });
      const url = r.verification_url;
      if (navigator.share) {
        await navigator.share({ title: snap.title ?? "Escrow Receipt", text: `Receipt ${receipt.receipt_number}`, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast({ title: "Verification link copied", description: url });
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Share failed", description: e?.message ?? "Try again" });
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <Link href="/transactions" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:underline">
          <ChevronLeft className="h-4 w-4" /> Back to transactions
        </Link>

        <header className="bg-white dark:bg-card rounded-2xl border border-[#EBEBEB] dark:border-border p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">{KIND_LABELS[tx.transaction_type] ?? "Escrow Transaction"}</h1>
              <div className="font-mono text-sm text-muted-foreground mt-1">{receipt?.receipt_number ?? "Pending receipt"}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Booking reference {data.booking?.escrow_account_reference ?? data.booking?.id?.slice(0, 8)}</div>
            </div>
            <Badge className="border-0 font-medium capitalize" style={{ background: meta.bg, color: meta.fg }}>
              {tx.transaction_status.replace(/_/g, " ")}
            </Badge>
          </div>
          <div className="mt-5 border-t border-[#EBEBEB] dark:border-border pt-5 flex items-end justify-between">
            <div>
              <div className="text-xs text-muted-foreground">Amount</div>
              <div className="text-3xl font-bold text-foreground mt-1">{formatNGN(tx.amount_ngn)}</div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={handleShare} disabled={!receipt}>
                <Share2 className="h-4 w-4 mr-2" /> Share
              </Button>
              <Button variant="outline" size="sm" onClick={handlePrint} disabled={!receipt}>
                <Printer className="h-4 w-4 mr-2" /> Print
              </Button>
              <Button size="sm" onClick={handleDownload} disabled={!receipt} style={{ background: "#FF5A5F", color: "#fff", border: "none" }}>
                <Download className="h-4 w-4 mr-2" /> Download PDF
              </Button>
            </div>
          </div>
        </header>

        {receipt && (
          <section className="bg-white dark:bg-card rounded-2xl border border-[#EBEBEB] dark:border-border p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Receipt notice</h2>
            <p className="text-sm text-foreground">{snap.notice ?? "Official receipt issued for this escrow transaction."}</p>
            <div className="mt-3 text-xs text-muted-foreground">
              Issued {formatDate(receipt.issued_at)} · Settlement {formatDate(tx.confirmed_at)}
            </div>
            {receipt.verification_token && (
              <Link
                href={`/verify/receipt/${receipt.verification_token}`}
                target="_blank"
                className="mt-3 inline-flex items-center gap-1 text-xs underline underline-offset-2"
              >
                <FileSearch className="h-3 w-3" /> Public verification link
              </Link>
            )}
          </section>
        )}

        <section className="bg-white dark:bg-card rounded-2xl border border-[#EBEBEB] dark:border-border p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Parties & Property</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Student</div>
              <div className="font-medium">{data.student ? `${data.student.first_name ?? ""} ${data.student.last_name ?? ""}`.trim() : "—"}</div>
              <div className="text-xs text-muted-foreground">{data.student?.email ?? ""}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Landlord</div>
              <div className="font-medium">{data.landlord ? `${data.landlord.first_name ?? ""} ${data.landlord.last_name ?? ""}`.trim() : "—"}</div>
              <div className="text-xs text-muted-foreground">{data.landlord?.email ?? ""}</div>
            </div>
            <div className="md:col-span-2">
              <div className="text-xs text-muted-foreground">Property</div>
              <div className="font-medium">{data.property?.address ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Payment method</div>
              <div className="font-medium capitalize">{tx.payment_method}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Reference</div>
              <div className="font-mono text-xs">{tx.gateway_reference ?? tx.gateway_transfer_code ?? "—"}</div>
            </div>
          </div>
        </section>

        <section className="bg-white dark:bg-card rounded-2xl border border-[#EBEBEB] dark:border-border p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Timeline</h2>
          {data.timeline.length === 0 ? (
            <p className="text-xs text-muted-foreground">No events yet.</p>
          ) : (
            <ol className="relative border-l border-[#EBEBEB] dark:border-border ml-1 space-y-3">
              {data.timeline.map((e) => (
                <li key={e.id} className="ml-3">
                  <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-[#FF5A5F] ring-2 ring-white" />
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" /> {formatDate(e.created_at as any)}
                  </div>
                  <div className="text-sm font-medium capitalize">
                    {e.action_type.replace(/_/g, " ")}
                    {e.actor_name && <span className="text-muted-foreground"> · {e.actor_name}{e.actor_role ? ` (${e.actor_role})` : ""}</span>}
                  </div>
                  {e.ip_address && <div className="text-xs text-muted-foreground font-mono">IP {e.ip_address}</div>}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

void CheckCircle2;
void AlertCircle;