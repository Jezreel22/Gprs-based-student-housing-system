"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetPendingVerificationsQueryOptions,
  getGetPendingPropertiesQueryOptions,
  getGetDisputesQueryOptions,
  useApproveVerification, useRejectVerification,
  useApproveProperty, useRejectProperty,
  useAdjudicateDispute,
} from "@/api";
import NavBar from "@/components/NavBar";
import TrustBadge from "@/components/TrustBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ShieldCheck, ShieldAlert, Home, AlertTriangle, CheckCircle, X, Gavel, Loader2, Wallet, Lock, FileWarning } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@/api/custom-fetch";

function formatNGN(n?: number | null) {
  return n ? `₦${n.toLocaleString("en-NG")}` : "₦—";
}

export default function Admin() {
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Dialogs
  const [rejectUser, setRejectUser] = useState<{ id: string; name: string } | null>(null);
  const [rejectProp, setRejectProp] = useState<{ id: string; address: string } | null>(null);
  const [adjudicateDispute, setAdjudicateDispute] = useState<{ id: string } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [adjDecision, setAdjDecision] = useState("dismissed");
  const [adjNotes, setAdjNotes] = useState("");
  const [adjRefundPct, setAdjRefundPct] = useState("");
  const [escrowBusy, setEscrowBusy] = useState<string | null>(null);
  // Report adjudication
  const [adjReport, setAdjReport] = useState<{ id: string; type: string; target: string } | null>(null);
  const [reportStatus, setReportStatus] = useState("substantiated");
  const [reportNotes, setReportNotes] = useState("");
  // Role gate (escrow-officer only). Render a gate until confirmed so the
  // admin shell — and its admin-only queries — never run for students/landlords.
  const [checked, setChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("naub_token");
    const raw = localStorage.getItem("naub_user");
    if (!token || !raw) { router.push("/login"); return; }
    // Guard the parse — a corrupt `naub_user` would throw in useEffect and
    // trip the client error boundary. Clear and re-login instead.
    let user: { role?: string } | null = null;
    try { user = JSON.parse(raw); } catch {
      localStorage.removeItem("naub_token");
      localStorage.removeItem("naub_user");
    }
    if (!user) { router.push("/login"); return; }
    setAllowed(user.role === "escrow_officer");
    setChecked(true);
  }, [router]);

  const { data: pendingUsers = [], refetch: refetchUsers } = useQuery({ ...getGetPendingVerificationsQueryOptions(), enabled: allowed });
  const { data: pendingPropsData, refetch: refetchProps } = useQuery({ ...getGetPendingPropertiesQueryOptions(), enabled: allowed });
  const { data: disputes = [], refetch: refetchDisputes } = useQuery({ ...getGetDisputesQueryOptions(), enabled: allowed });
  // Bookings awaiting escrow oversight (release / hold / retry).
  const { data: escrowData, refetch: refetchEscrow } = useQuery<{ items: any[] }>({
    queryKey: ["admin", "escrow-bookings"],
    enabled: allowed,
    queryFn: () => customFetch<{ items: any[] }>("/api/admin/bookings"),
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });
  const escrowBookings = (escrowData as any)?.items ?? [];
  // Trust reports queue
  const { data: reportsData, refetch: refetchReports } = useQuery<any[]>({
    queryKey: ["admin", "reports"],
    enabled: allowed,
    queryFn: () => customFetch<any[]>("/api/admin/reports?open_only=true"),
  });
  const openReports: any[] = Array.isArray(reportsData) ? reportsData : [];

  async function releaseEscrowNow(id: string) {
    setEscrowBusy(id);
    try {
      const res = await customFetch<{ message: string }>(`/api/bookings/${id}/release-escrow`, { method: "POST" });
      toast({ title: res.message ?? "Release initiated" });
      refetchEscrow();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Release failed", description: e?.message ?? "Try again" });
    } finally {
      setEscrowBusy(null);
    }
  }

  async function toggleHold(id: string, currentlyHeld: boolean) {
    setEscrowBusy(id);
    try {
      await customFetch(`/api/bookings/${id}/hold-release`, {
        method: "POST",
        body: JSON.stringify({ release: currentlyHeld }),
      });
      toast({ title: currentlyHeld ? "Hold cleared" : "Release held" });
      refetchEscrow();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed", description: e?.message ?? "Try again" });
    } finally {
      setEscrowBusy(null);
    }
  }

  // Managed-escrow disbursement: the officer confirms the manual bank transfer
  // to the landlord was actually sent. Only meaningful for `release_pending`
  // rows (tenant already approved).
  async function adjudicateReport() {
    if (!adjReport || !reportNotes) return;
    try {
      await customFetch(`/api/admin/reports/${adjReport.id}/adjudicate`, {
        method: "POST",
        body: JSON.stringify({ status: reportStatus, officer_notes: reportNotes }),
      });
      toast({ title: `Report ${reportStatus}` });
      setAdjReport(null); setReportNotes(""); setReportStatus("substantiated");
      refetchReports();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed", description: e?.message ?? "Try again" });
    }
  }

  async function markDisbursed(id: string) {
    setEscrowBusy(id);
    try {
      const res = await customFetch<{ message: string }>(`/api/bookings/${id}/mark-disbursed`, { method: "POST" });
      toast({ title: res.message ?? "Marked as disbursed" });
      refetchEscrow();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed", description: e?.message ?? "Try again" });
    } finally {
      setEscrowBusy(null);
    }
  }

  const pendingProps = (pendingPropsData as any)?.data ?? [];

  const approveMutation = useApproveVerification();
  const rejectUserMutation = useRejectVerification();
  const approvePropMutation = useApproveProperty();
  const rejectPropMutation = useRejectProperty();
  const adjudicateMutation = useAdjudicateDispute();

  const handleApproveUser = (id: string) => {
    approveMutation.mutate({ id }, {
      onSuccess: () => { toast({ title: "User verified" }); refetchUsers(); },
      onError: () => toast({ variant: "destructive", title: "Failed" }),
    });
  };

  const handleRejectUser = () => {
    if (!rejectUser || !rejectReason) return;
    rejectUserMutation.mutate({ id: rejectUser.id, data: { reason: rejectReason } }, {
      onSuccess: () => { toast({ title: "Verification rejected" }); setRejectUser(null); setRejectReason(""); refetchUsers(); },
      onError: () => toast({ variant: "destructive", title: "Failed" }),
    });
  };

  const handleApproveProp = (id: string) => {
    approvePropMutation.mutate({ id }, {
      onSuccess: () => { toast({ title: "Property published live" }); refetchProps(); },
      onError: () => toast({ variant: "destructive", title: "Failed" }),
    });
  };

  const handleRejectProp = () => {
    if (!rejectProp || !rejectReason) return;
    rejectPropMutation.mutate({ id: rejectProp.id, data: { reason: rejectReason } }, {
      onSuccess: () => { toast({ title: "Property rejected" }); setRejectProp(null); setRejectReason(""); refetchProps(); },
      onError: () => toast({ variant: "destructive", title: "Failed" }),
    });
  };

  const handleAdjudicate = () => {
    if (!adjudicateDispute || !adjNotes) return;
    adjudicateMutation.mutate({
      id: adjudicateDispute.id,
      data: {
        decision: adjDecision as any,
        adjudication_notes: adjNotes,
        refund_percentage_to_student: adjRefundPct ? parseInt(adjRefundPct) : undefined,
      },
    }, {
      onSuccess: () => {
        toast({ title: "Dispute adjudicated" });
        setAdjudicateDispute(null);
        setAdjNotes(""); setAdjDecision("dismissed");
        refetchDisputes();
      },
      onError: () => toast({ variant: "destructive", title: "Failed" }),
    });
  };

  const openDisputes = (disputes as any[]).filter(d => ["open", "under_investigation"].includes(d.dispute_status));
  const resolvedDisputes = (disputes as any[]).filter(d => ["resolved", "closed"].includes(d.dispute_status));

  if (!checked) {
    return (
      <div className="min-h-screen bg-[#F7F7F7]">
        <NavBar />
        <div className="max-w-5xl mx-auto px-4 py-8">
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
          <p className="text-muted-foreground mb-6">
            This area is for escrow officers. If you reached this by mistake, head back to your dashboard.
          </p>
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

      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Escrow Officer Admin Panel
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Review verifications, approve listings, and adjudicate disputes.</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-2xl border border-[#EBEBEB] p-5 text-center">
            <div className="text-3xl font-bold text-primary">{(pendingUsers as any[]).length}</div>
            <div className="text-sm text-muted-foreground mt-1">Pending Verifications</div>
          </div>
          <div className="bg-white rounded-2xl border border-[#EBEBEB] p-5 text-center">
            <div className="text-3xl font-bold text-amber-500">{pendingProps.length}</div>
            <div className="text-sm text-muted-foreground mt-1">Listings for Review</div>
          </div>
          <div className="bg-white rounded-2xl border border-[#EBEBEB] p-5 text-center">
            <div className="text-3xl font-bold text-red-500">{openDisputes.length}</div>
            <div className="text-sm text-muted-foreground mt-1">Open Disputes</div>
          </div>
          <div className="bg-white rounded-2xl border border-[#EBEBEB] p-5 text-center">
            <div className="text-3xl font-bold text-orange-500">{openReports.length}</div>
            <div className="text-sm text-muted-foreground mt-1">Trust Reports</div>
          </div>
        </div>

        <Tabs defaultValue="verifications" className="space-y-6">
          <TabsList className="bg-white border border-[#EBEBEB] h-auto p-1 rounded-xl flex-wrap">
            <TabsTrigger value="verifications" className="rounded-lg px-4">
              Verifications {(pendingUsers as any[]).length > 0 && <Badge className="ml-2 bg-primary text-white text-xs">{(pendingUsers as any[]).length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="listings" className="rounded-lg px-4">
              Listings {pendingProps.length > 0 && <Badge className="ml-2 bg-amber-500 text-white text-xs">{pendingProps.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="disputes" className="rounded-lg px-4">
              Disputes {openDisputes.length > 0 && <Badge className="ml-2 bg-red-500 text-white text-xs">{openDisputes.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="reports" className="rounded-lg px-4">
              Reports {openReports.length > 0 && <Badge className="ml-2 bg-orange-500 text-white text-xs">{openReports.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="escrow" className="rounded-lg px-4">
              Escrow {escrowBookings.length > 0 && <Badge className="ml-2 bg-blue-500 text-white text-xs">{escrowBookings.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          {/* VERIFICATIONS TAB */}
          <TabsContent value="verifications">
            {(pendingUsers as any[]).length === 0 ? (
              <div className="text-center py-16 bg-white rounded-2xl border border-[#EBEBEB]">
                <CheckCircle className="h-12 w-12 mx-auto mb-3 text-green-500 opacity-60" />
                <h3 className="font-semibold">All Clear!</h3>
                <p className="text-muted-foreground text-sm">No pending verifications.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {(pendingUsers as any[]).map((u: any) => (
                  <div key={u.id} className="bg-white rounded-xl border border-[#EBEBEB] p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                            {u.first_name?.[0] ?? u.role?.[0]?.toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-sm">{u.first_name} {u.last_name}</p>
                            <p className="text-xs text-muted-foreground capitalize">{u.role?.replace("_", " ")} · {u.email}</p>
                            {u.trust_score && ["landlord", "agent"].includes(u.role ?? "") && (
                              <div className="mt-0.5">
                                <TrustBadge score={u.trust_score?.total_score ?? 50} size="sm" />
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 mt-2 ml-11">
                          {u.national_id_document_url && (
                            <a href={u.national_id_document_url} target="_blank" rel="noopener noreferrer"
                               className="text-xs text-primary hover:underline">National ID ↗</a>
                          )}
                          {u.selfie_url && (
                            <a href={u.selfie_url} target="_blank" rel="noopener noreferrer"
                               className="text-xs text-primary hover:underline">Selfie ↗</a>
                          )}
                          {u.letter_of_agency_url && (
                            <a href={u.letter_of_agency_url} target="_blank" rel="noopener noreferrer"
                               className="text-xs text-primary hover:underline">Letter of Agency ↗</a>
                          )}
                          {u.matriculation_number && (
                            <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">Matric: {u.matriculation_number}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          style={{ background: "#34A853", color: "#fff", border: "none" }}
                          className="gap-1 text-xs"
                          onClick={() => handleApproveUser(u.id)}
                          disabled={approveMutation.isPending}
                        >
                          <CheckCircle className="h-3.5 w-3.5" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 text-xs border-destructive/50 text-destructive"
                          onClick={() => setRejectUser({ id: u.id, name: `${u.first_name} ${u.last_name}` })}
                        >
                          <X className="h-3.5 w-3.5" /> Reject
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* LISTINGS TAB */}
          <TabsContent value="listings">
            {pendingProps.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-2xl border border-[#EBEBEB]">
                <Home className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <h3 className="font-semibold">No listings pending review</h3>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingProps.map((p: any) => (
                  <div key={p.id} className="bg-white rounded-xl border border-[#EBEBEB] p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex gap-4">
                        <div className="w-16 h-16 rounded-xl bg-gray-100 overflow-hidden shrink-0">
                          {p.hero_photo_url ? (
                            <img src={p.hero_photo_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center"><Home className="h-7 w-7 text-muted-foreground opacity-50" /></div>
                          )}
                        </div>
                        <div>
                          <p className="font-semibold text-sm">{p.address}</p>
                          <p className="text-xs text-muted-foreground">{p.rooms} room(s) · {formatNGN(p.rent_amount_ngn)}/mo</p>
                          {p.landlord && (
                            <p className="text-xs text-muted-foreground mt-1">
                              By: {p.landlord.first_name} {p.landlord.last_name} · {p.landlord.verification_status === "verified" ? (
                                <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle className="h-3 w-3" /> Verified</span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="h-3 w-3" /> Unverified</span>
                              )}
                            </p>
                          )}
                          <Link href={`/properties/${p.id}`} className="text-xs text-primary hover:underline">View full listing ↗</Link>
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          style={{ background: "#34A853", color: "#fff", border: "none" }}
                          className="gap-1 text-xs"
                          onClick={() => handleApproveProp(p.id)}
                          disabled={approvePropMutation.isPending}
                        >
                          <CheckCircle className="h-3.5 w-3.5" /> Publish Live
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1 text-xs border-destructive/50 text-destructive"
                          onClick={() => setRejectProp({ id: p.id, address: p.address })}
                        >
                          <X className="h-3.5 w-3.5" /> Reject
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* DISPUTES TAB */}
          <TabsContent value="disputes">
            {(disputes as any[]).length === 0 ? (
              <div className="text-center py-16 bg-white rounded-2xl border border-[#EBEBEB]">
                <Gavel className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <h3 className="font-semibold">No disputes</h3>
              </div>
            ) : (
              <div className="space-y-3">
                {(disputes as any[]).map((d: any) => {
                  const isOpen = ["open", "under_investigation"].includes(d.dispute_status);
                  return (
                    <div key={d.id} className="bg-white rounded-xl border border-[#EBEBEB] p-5">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-2">
                            <AlertTriangle className={`h-4 w-4 shrink-0 ${isOpen ? "text-red-500" : "text-green-500"}`} />
                            <Badge
                              className="capitalize text-xs"
                              style={{
                                background: isOpen ? "#FFEBEE" : "#E8F5E9",
                                color: isOpen ? "#C62828" : "#2E7D32",
                                border: "none",
                              }}
                            >
                              {d.dispute_status.replace("_", " ")}
                            </Badge>
                            <span className="text-xs text-muted-foreground capitalize">{d.reason?.replace(/_/g, " ")}</span>
                          </div>
                          <p className="text-sm font-medium mb-1">{d.booking?.property?.address ?? "Property"}</p>
                          <p className="text-xs text-muted-foreground">{d.description}</p>
                          <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                            <span>Student: {d.student?.first_name} {d.student?.last_name}</span>
                            <span>Landlord: {d.landlord?.first_name} {d.landlord?.last_name}</span>
                          </div>
                          {d.adjudication_decision && (
                            <p className="text-xs text-green-600 font-medium mt-1">
                              Decision: {d.adjudication_decision.replace(/_/g, " ")} — {d.adjudication_notes}
                            </p>
                          )}
                        </div>
                        {isOpen && (
                          <Button
                            size="sm"
                            style={{ background: "#FF5A5F", color: "#fff", border: "none" }}
                            className="gap-1 text-xs shrink-0"
                            onClick={() => setAdjudicateDispute({ id: d.id })}
                          >
                            <Gavel className="h-3.5 w-3.5" /> Adjudicate
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* REPORTS TAB */}
          <TabsContent value="reports">
            {openReports.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-2xl border border-[#EBEBEB]">
                <FileWarning className="h-12 w-12 mx-auto mb-3 opacity-20" />
                <h3 className="font-semibold">No open reports</h3>
                <p className="text-muted-foreground text-sm">All trust reports have been reviewed.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {openReports.map((r: any) => (
                  <div key={r.id} className="bg-white rounded-xl border border-[#EBEBEB] p-5">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span
                            className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full"
                            style={{ background: "#FFF3E0", color: "#C2410C" }}
                          >
                            <FileWarning className="h-3 w-3" />
                            {r.report_type?.replace(/_/g, " ")}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Filed {r.created_at ? new Date(r.created_at).toLocaleDateString() : ""}
                          </span>
                        </div>
                        <p className="text-sm font-medium mb-1 line-clamp-2">{r.description}</p>
                        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mt-1">
                          <span>
                            Reporter: <span className="text-foreground font-medium">
                              {r.reporter?.first_name} {r.reporter?.last_name} ({r.reporter?.role})
                            </span>
                          </span>
                          {r.target_user && (
                            <span className="flex items-center gap-1.5">
                              Target: <span className="text-foreground font-medium">
                                {r.target_user.first_name} {r.target_user.last_name}
                              </span>
                              {r.target_user && ["landlord", "agent"].includes(r.target_user.role ?? "") && <TrustBadge score={r.target_user?.trust_score?.total_score ?? 50} size="sm" showLabel={false} />}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        style={{ background: "#FF5A5F", color: "#fff", border: "none" }}
                        className="gap-1 text-xs shrink-0"
                        onClick={() => setAdjReport({
                          id: r.id,
                          type: r.report_type?.replace(/_/g, " "),
                          target: `${r.target_user?.first_name ?? "Unknown"} ${r.target_user?.last_name ?? ""}`,
                        })}
                      >
                        <Gavel className="h-3.5 w-3.5" /> Review
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="escrow">
            {escrowBookings.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-2xl border border-[#EBEBEB]">
                <Wallet className="h-12 w-12 mx-auto mb-3 text-blue-500 opacity-60" />
                <h3 className="font-semibold">Nothing to release</h3>
                <p className="text-muted-foreground text-sm">No bookings are awaiting escrow release.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {escrowBookings.map((b: any) => {
                  const status = b.booking_status;
                  const color = status === "release_pending" ? "#1565C0" : status === "release_failed" ? "#C62828" : "#F57F17";
                  const awaitingDisbursement = status === "release_pending";
                  const hasBank = Boolean(b.landlord_account_number && b.landlord_bank_code);
                  return (
                    <div key={b.id} className="bg-white rounded-2xl border border-[#EBEBEB] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge style={{ background: color + "20", color, border: "none" }} className="text-xs capitalize">
                            {status.replace("_", " ")}
                          </Badge>
                          {b.release_held && (
                            <Badge className="bg-amber-100 text-amber-700 border-0 text-xs">On hold</Badge>
                          )}
                        </div>
                        <p className="text-sm font-medium truncate">{b.property_address ?? "Property"}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatNGN(b.total_amount_ngn)} • Landlord: {b.landlord_name ?? "—"} • Student: {b.student_name ?? "—"}
                        </p>
                        {/* Context for the officer: when funds landed (so they
                            can spot stale holds) and the occupancy code the
                            landlord is expected to hand the student. */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                          {b.funds_received_at && (
                            <span className="text-xs text-muted-foreground">
                              Held since {new Date(b.funds_received_at).toLocaleDateString()}
                            </span>
                          )}
                          {b.occupancy_code && (
                            <span className="inline-flex items-center gap-1 text-xs">
                              <Lock className="h-3 w-3 text-amber-700" />
                              <span className="text-muted-foreground">Code:</span>
                              <span className="font-mono font-bold tracking-[0.2em] text-amber-900">{b.occupancy_code}</span>
                            </span>
                          )}
                        </div>
                        {/* Disbursement target for managed-escrow payouts. */}
                        {awaitingDisbursement && (
                          hasBank ? (
                            <div className="mt-2 inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-xs bg-blue-50 border border-blue-100 rounded-md px-2.5 py-1.5">
                              <span className="font-medium text-blue-900">Pay to:</span>
                              <span className="font-mono text-blue-900">{b.landlord_account_number}</span>
                              <span className="text-blue-700">{b.landlord_account_name ?? ""}</span>
                            </div>
                          ) : (
                            <p className="text-xs text-amber-700 mt-1.5">Landlord hasn't set payout bank details — disbursement blocked.</p>
                          )
                        )}
                        {b.payout_error && (
                          <p className="text-xs text-red-600 mt-1">Last error: {b.payout_error}</p>
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        {awaitingDisbursement ? (
                          <Button
                            size="sm"
                            disabled={escrowBusy === b.id || !hasBank}
                            onClick={() => markDisbursed(b.id)}
                            style={{ background: "#16A34A", color: "#fff", border: "none" }}
                          >
                            {escrowBusy === b.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mark disbursed"}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            disabled={escrowBusy === b.id}
                            onClick={() => releaseEscrowNow(b.id)}
                            style={{ background: "#FF5A5F", color: "#fff", border: "none" }}
                          >
                            {escrowBusy === b.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Release now"}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={escrowBusy === b.id}
                          onClick={() => toggleHold(b.id, b.release_held)}
                        >
                          {b.release_held ? "Clear hold" : "Hold"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Reject User Dialog */}
      <Dialog open={!!rejectUser} onOpenChange={() => setRejectUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Verification: {rejectUser?.name}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-sm font-medium mb-2 block">Reason for rejection *</Label>
            <Textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="e.g. Unclear ID photo, expired document, selfie doesn't match..."
              rows={3}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRejectUser(null)}>Cancel</Button>
            <Button
              style={{ background: "#E1444A", color: "#fff", border: "none" }}
              onClick={handleRejectUser}
              disabled={!rejectReason || rejectUserMutation.isPending}
            >
              Confirm Rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Property Dialog */}
      <Dialog open={!!rejectProp} onOpenChange={() => setRejectProp(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Listing: {rejectProp?.address}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-sm font-medium mb-2 block">Reason for rejection *</Label>
            <Textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="e.g. Stock photos used, address unverifiable, price misleading..."
              rows={3}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRejectProp(null)}>Cancel</Button>
            <Button
              style={{ background: "#E1444A", color: "#fff", border: "none" }}
              onClick={handleRejectProp}
              disabled={!rejectReason || rejectPropMutation.isPending}
            >
              Reject Listing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adjudicate Dispute Dialog */}
      <Dialog open={!!adjudicateDispute} onOpenChange={() => setAdjudicateDispute(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjudicate Dispute</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-sm font-medium mb-1.5 block">Decision</Label>
              <Select value={adjDecision} onValueChange={setAdjDecision}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dismissed">Dismissed — Landlord Favoured</SelectItem>
                  <SelectItem value="partial_refund">Partial Refund to Student</SelectItem>
                  <SelectItem value="full_refund">Full Refund to Student</SelectItem>
                  <SelectItem value="fraud_substantiated">Fraud Substantiated — Landlord Banned</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {adjDecision === "partial_refund" && (
              <div>
                <Label className="text-sm font-medium mb-1.5 block">Refund % to Student (0–100)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={adjRefundPct}
                  onChange={e => setAdjRefundPct(e.target.value)}
                  placeholder="e.g. 50"
                />
              </div>
            )}
            <div>
              <Label className="text-sm font-medium mb-1.5 block">Adjudication Notes *</Label>
              <Textarea
                value={adjNotes}
                onChange={e => setAdjNotes(e.target.value)}
                placeholder="Document your findings and rationale..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAdjudicateDispute(null)}>Cancel</Button>
            <Button
              style={{ background: "#FF5A5F", color: "#fff", border: "none" }}
              onClick={handleAdjudicate}
              disabled={!adjNotes || adjudicateMutation.isPending}
            >
              <Gavel className="h-4 w-4 mr-2" />
              {adjudicateMutation.isPending ? "Processing..." : "Issue Ruling"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Report Adjudication Dialog */}
      <Dialog open={!!adjReport} onOpenChange={() => setAdjReport(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review Trust Report</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="text-sm text-muted-foreground bg-[#FAFAFA] rounded-xl p-3 border border-[#EBEBEB]">
              <span className="font-semibold text-foreground capitalize">{adjReport?.type}</span>
              {" "}report against <span className="font-semibold text-foreground">{adjReport?.target}</span>
            </div>
            <div>
              <Label className="text-sm font-medium mb-1.5 block">Decision</Label>
              <Select value={reportStatus} onValueChange={setReportStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="substantiated">Substantiated — Apply trust penalty</SelectItem>
                  <SelectItem value="dismissed">Dismissed — No action taken</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm font-medium mb-1.5 block">Officer Notes *</Label>
              <Textarea
                value={reportNotes}
                onChange={e => setReportNotes(e.target.value)}
                placeholder="Document your review findings and rationale..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAdjReport(null)}>Cancel</Button>
            <Button
              style={{ background: reportStatus === "substantiated" ? "#E1444A" : "#34A853", color: "#fff", border: "none" }}
              onClick={adjudicateReport}
              disabled={!reportNotes}
            >
              <Gavel className="h-4 w-4 mr-2" />
              {reportStatus === "substantiated" ? "Substantiate" : "Dismiss"} Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}