"use client";

import { useEffect, useState } from "react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { customFetch } from "@/api/custom-fetch";
import {
  X, Send, AlertTriangle, ShieldAlert, ShieldCheck, Clock, FileText, ExternalLink, Lock,
} from "lucide-react";
import { colorFor, formatDate, formatDateOnly, formatNGN, labelFor } from "./status";
import { useEscrowBookingDetail } from "./useEscrowBookings";

interface Props {
  bookingId: string | null;
  onClose: () => void;
  onMutated: () => void;
}

/**
 * Per-transaction detail drawer. Lazily loads the detail endpoint on open,
 * shows:
 *   - Money + status summary
 *   - Property snippet (address + thumbnail)
 *   - Tenant + landlord cards (with verification + trust score when available)
 *   - Payment evidence links
 *   - Payout bank block
 *   - Admin actions: Verify, Reject, Disburse (with confirmation modal), Add note
 *   - Admin notes list (newest first)
 *   - Audit-history timeline
 */
export function EscrowDetailDrawer({ bookingId, onClose, onMutated }: Props) {
  const open = bookingId != null;
  const { toast } = useToast();
  const { data, refetch } = useEscrowBookingDetail(bookingId, open);

  // Local form state for note add
  const [note, setNote] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectBusy, setRejectBusy] = useState(false);
  const [disburseOpen, setDisburseOpen] = useState(false);
  const [disburseAgree, setDisburseAgree] = useState(false);
  const [disburseReference, setDisburseReference] = useState("");
  const [disburseBusy, setDisburseBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setNote(""); setRejectReason(""); setDisburseAgree(false); setDisburseReference("");
    }
  }, [open]);

  if (!open || !data) return null;
  const b = data.booking;
  const stageColor = colorFor(b.stage);
  const property = data.property;
  const student = data.student;
  const landlord = data.landlord;
  const notes = data.notes as Array<{ id: string; note: string; officer_name: string | null; created_at: string | null }>;
  const audit = data.audit as Array<{ id: string; action_type: string; actor_name: string | null; actor_role: string | null; details: any; ip_address: string | null; user_agent: string | null; created_at: string | null }>;

  async function postToggleVerify() {
    if (!bookingId) return;
    setVerifyBusy(true);
    try {
      await customFetch(`/api/admin/bookings/${bookingId}/verify`, {
        method: "POST",
        body: JSON.stringify({ under_verification: !b.under_verification }),
      });
      toast({ title: b.under_verification ? "Verification flag cleared" : "Flagged for verification" });
      refetch();
      onMutated();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed", description: e?.message ?? "Try again" });
    } finally {
      setVerifyBusy(false);
    }
  }

  async function submitReject() {
    if (!bookingId || rejectReason.trim().length < 10) return;
    setRejectBusy(true);
    try {
      await customFetch(`/api/admin/bookings/${bookingId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      toast({ title: "Booking rejected" });
      setRejectOpen(false); setRejectReason("");
      refetch();
      onMutated();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed", description: e?.message ?? "Try again" });
    } finally {
      setRejectBusy(false);
    }
  }

  async function submitDisburse() {
    if (!bookingId || !disburseAgree) return;
    setDisburseBusy(true);
    try {
      await customFetch(`/api/bookings/${bookingId}/mark-disbursed`, {
        method: "POST",
        body: JSON.stringify(disburseReference.trim() ? { reference: disburseReference.trim() } : {}),
      });
      toast({ title: "Disbursement confirmed" });
      setDisburseOpen(false); setDisburseAgree(false); setDisburseReference("");
      refetch();
      onMutated();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed", description: e?.message ?? "Try again" });
    } finally {
      setDisburseBusy(false);
    }
  }

  async function submitNote() {
    if (!bookingId || note.trim().length === 0) return;
    setNoteBusy(true);
    try {
      await customFetch(`/api/admin/bookings/${bookingId}/notes`, {
        method: "POST",
        body: JSON.stringify({ note: note.trim() }),
      });
      setNote("");
      refetch();
      onMutated();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed", description: e?.message ?? "Try again" });
    } finally {
      setNoteBusy(false);
    }
  }

  const canReject = ["payment_pending", "pending_payment", "payment_received", "pending_occupancy", "under_verification", "verified", "pending_review", "release_pending", "release_failed"].includes(b.booking_status);
  const canDisburse = b.booking_status === "release_pending"
    && Boolean(landlord?.payout_account_number) && Boolean(landlord?.payout_bank_code);
  const canToggleVerify = b.booking_status === "pending_occupancy";

  return (
    <>
      <Drawer open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DrawerContent className="max-h-[90vh]">
          <DrawerHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <DrawerTitle className="text-xl">{property?.address ?? "Booking"}</DrawerTitle>
                <DrawerDescription>
                  Booking ID <span className="font-mono">{b.id.slice(0, 8)}</span> · Last updated {formatDate(b.updated_at)}
                </DrawerDescription>
              </div>
              <Badge className="border-0" style={{ background: stageColor.bg, color: stageColor.fg }}>
                {b.stage_label}
              </Badge>
            </div>
          </DrawerHeader>

          <div className="overflow-y-auto px-6 pb-6 space-y-6">
            {/* Money block */}
            <section className="bg-[#FAFAFA] rounded-xl border border-[#EBEBEB] p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Money</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground">Amount paid</div>
                  <div className="text-lg font-bold">{formatNGN(b.total_amount_ngn)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Rent + deposit</div>
                  <div className="text-sm font-medium">{formatNGN((b.rent_amount_ngn ?? 0) + (b.deposit_amount_ngn ?? 0))}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Escrow fee</div>
                  <div className="text-sm font-medium">{formatNGN(b.escrow_fee_ngn)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Net to landlord</div>
                  <div className="text-lg font-bold text-green-700">{formatNGN(b.total_amount_ngn - (b.escrow_fee_ngn ?? 0))}</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>Method: <span className="text-foreground font-medium">{b.payment_method ?? "—"}</span></div>
                <div>Funds received: <span className="text-foreground font-medium">{b.funds_received_at ? new Date(b.funds_received_at).toLocaleString() : "—"}</span></div>
                <div>Escrow ref: <span className="text-foreground font-mono text-[11px]">{b.escrow_account_reference ?? "—"}</span></div>
                <div>
                  Payment txn:
                  {" "}
                  {b.payment_transaction_id ? (
                    <a
                      className="text-foreground underline underline-offset-2 inline-flex items-center gap-1"
                      href={`https://dashboard.paystack.com/#/transactions/${encodeURIComponent(b.payment_transaction_id)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {b.payment_transaction_id.slice(0, 18)}… <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : "—"}
                </div>
              </div>
            </section>

            {/* Property snippet */}
            {property && (
              <section className="grid grid-cols-1 md:grid-cols-[120px_1fr] gap-4 bg-white border border-[#EBEBEB] rounded-xl p-4">
                {data.photos?.[0]?.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={data.photos[0].photo_url} alt="" className="h-24 w-full md:w-32 object-cover rounded-md" />
                ) : (
                  <div className="h-24 w-full md:w-32 bg-[#F3F4F6] rounded-md" />
                )}
                <div>
                  <div className="text-sm font-medium">{property.address}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {formatNGN(property.rent_amount_ngn)} rent · {formatNGN(property.deposit_amount_ngn)} deposit · listing {property.listing_status}
                  </div>
                  {property.occupancy_code && (
                    <div className="mt-2 inline-flex items-center gap-2 text-xs">
                      <Lock className="h-3.5 w-3.5 text-amber-700" />
                      <span className="text-muted-foreground">Occupancy code</span>
                      <span className="font-mono font-bold tracking-[0.2em] text-amber-900">{property.occupancy_code}</span>
                    </div>
                  )}
                  <div className="mt-2 text-xs text-muted-foreground grid grid-cols-2 gap-1">
                    <div>Lease start: <span className="text-foreground font-medium">{formatDateOnly(b.lease_start_date)}</span></div>
                    <div>Lease end: <span className="text-foreground font-medium">{formatDateOnly(b.lease_end_date)}</span></div>
                  </div>
                </div>
              </section>
            )}

            {/* Participants */}
            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {student && (
                <ParticipantCard
                  title="Tenant"
                  name={`${student.first_name ?? ""} ${student.last_name ?? ""}`.trim()}
                  email={student.email}
                  phone={student.phone_number}
                  verification={student.verification_status}
                  profilePhotoUrl={student.profile_photo_url}
                  trustScore={student.trust_score?.total_score}
                />
              )}
              {landlord && (
                <ParticipantCard
                  title="Landlord"
                  name={`${landlord.first_name ?? ""} ${landlord.last_name ?? ""}`.trim()}
                  email={landlord.email}
                  phone={landlord.phone_number}
                  verification={landlord.verification_status}
                  profilePhotoUrl={landlord.profile_photo_url}
                  trustScore={landlord.trust_score?.total_score}
                  bankCode={landlord.payout_bank_code}
                  bankAccount={landlord.payout_account_number}
                  bankAccountName={landlord.payout_account_name}
                />
              )}
            </section>

            {/* Actions */}
            <section className="bg-white border border-[#EBEBEB] rounded-xl p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Officer actions</h3>
              <div className="flex flex-wrap gap-2">
                {canToggleVerify && (
                  <Button
                    variant="outline"
                    disabled={verifyBusy}
                    onClick={postToggleVerify}
                  >
                    {b.under_verification ? <ShieldCheck className="h-4 w-4 mr-1.5" /> : <ShieldAlert className="h-4 w-4 mr-1.5" />}
                    {b.under_verification ? "Clear verification flag" : "Flag as under verification"}
                  </Button>
                )}
                <Button
                  style={{ background: "#16A34A", color: "#fff", border: "none" }}
                  disabled={!canDisburse || disburseBusy}
                  onClick={() => setDisburseOpen(true)}
                >
                  <Send className="h-4 w-4 mr-1.5" />
                  Disburse funds
                </Button>
                {canReject && (
                  <Button
                    variant="outline"
                    style={{ borderColor: "#FCA5A5", color: "#B91C1C" }}
                    disabled={rejectBusy}
                    onClick={() => setRejectOpen(true)}
                  >
                    <AlertTriangle className="h-4 w-4 mr-1.5" />
                    Reject
                  </Button>
                )}
                {b.release_held && (
                  <Button
                    variant="outline"
                    disabled
                    title="Release is held by an officer"
                  >
                    <Lock className="h-4 w-4 mr-1.5" /> On hold
                  </Button>
                )}
              </div>
              {!canDisburse && b.booking_status === "release_pending" && (
                <p className="text-xs text-amber-700 mt-2">
                  Landlord hasn't set payout bank details — disbursement is blocked.
                </p>
              )}
              {b.payout_error && (
                <div className="mt-3 text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
                  Last payout error: {b.payout_error}
                </div>
              )}
            </section>

            {/* Notes */}
            <section className="bg-white border border-[#EBEBEB] rounded-xl p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Internal officer notes</h3>
              <div className="space-y-2 mb-3">
                {notes.length === 0 && <p className="text-xs text-muted-foreground">No notes yet.</p>}
                {notes.map((n) => (
                  <div key={n.id} className="bg-[#FAFAFA] border border-[#EBEBEB] rounded-lg p-3">
                    <div className="text-xs font-medium text-muted-foreground mb-1">{n.officer_name ?? "—"} · {formatDate(n.created_at)}</div>
                    <div className="text-sm whitespace-pre-wrap">{n.note}</div>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <Textarea
                  placeholder="Add an internal note for the audit trail (visible to officers only)…"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" disabled={noteBusy || note.trim().length === 0} onClick={submitNote}>
                    {noteBusy ? "Saving…" : "Save note"}
                  </Button>
                </div>
              </div>
            </section>

            {/* Audit history */}
            <section className="bg-white border border-[#EBEBEB] rounded-xl p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Audit history</h3>
              {audit.length === 0 && <p className="text-xs text-muted-foreground">No audit events yet.</p>}
              <ol className="relative border-l border-[#EBEBEB] ml-1 space-y-3">
                {audit.map((a) => {
                  const details = (a.details ?? {}) as Record<string, any>;
                  return (
                    <li key={a.id} className="ml-3">
                      <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-[#FF5A5F] ring-2 ring-white" />
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatDate(a.created_at)}
                      </div>
                      <div className="text-sm font-medium">
                        <span className="capitalize">{a.action_type.replace(/_/g, " ")}</span>
                        {a.actor_name && <span className="text-muted-foreground"> · {a.actor_name}{a.actor_role ? ` (${a.actor_role})` : ""}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {details.previous_status && details.new_status && (
                          <span>Status: <span className="font-mono text-[11px]">{details.previous_status}</span> → <span className="font-mono text-[11px]">{details.new_status}</span></span>
                        )}
                        {a.ip_address && <span className="ml-2">IP: <span className="font-mono text-[11px]">{a.ip_address}</span></span>}
                      </div>
                      {details.reason && (
                        <div className="text-xs text-muted-foreground mt-1 italic">"{details.reason}"</div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>
        </DrawerContent>
      </Drawer>

      {/* Reject modal */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this booking?</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <p className="text-sm text-muted-foreground">
              This cancels the booking and records the reason in the immutable audit trail.
              The current stage is <strong>{b.stage_label}</strong>.
            </p>
            <Label className="text-sm font-medium">Reason *</Label>
            <Textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="At least 10 characters. Explain the grounds for rejection…"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button
              style={{ background: "#B91C1C", color: "#fff", border: "none" }}
              disabled={rejectBusy || rejectReason.trim().length < 10}
              onClick={submitReject}
            >
              {rejectBusy ? "Rejecting…" : "Reject booking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disburse confirmation modal */}
      <Dialog open={disburseOpen} onOpenChange={(o) => { if (!disburseBusy) setDisburseOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm disbursement</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm bg-[#FAFAFA] border border-[#EBEBEB] rounded-lg p-3">
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground">Property</div>
                <div className="font-medium">{property?.address ?? "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Tenant</div>
                <div className="font-medium">{student ? `${student.first_name ?? ""} ${student.last_name ?? ""}`.trim() : "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Landlord</div>
                <div className="font-medium">{landlord ? `${landlord.first_name ?? ""} ${landlord.last_name ?? ""}`.trim() : "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Amount paid</div>
                <div className="font-medium">{formatNGN(b.total_amount_ngn)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Escrow fee</div>
                <div className="font-medium">{formatNGN(b.escrow_fee_ngn)}</div>
              </div>
              <div className="col-span-2 border-t border-[#EBEBEB] pt-3">
                <div className="text-xs text-muted-foreground">Net amount to landlord</div>
                <div className="text-xl font-bold text-green-700">{formatNGN(b.total_amount_ngn - (b.escrow_fee_ngn ?? 0))}</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground">Payout to</div>
                <div className="font-mono text-sm">
                  {landlord?.payout_account_number} · {landlord?.payout_account_name}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground">Booking reference</div>
                <div className="font-mono text-xs">{b.escrow_account_reference ?? b.id}</div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Receipt reference (optional)</Label>
              <Input
                placeholder="e.g. NEFT/2026/07/22/0001"
                value={disburseReference}
                onChange={(e) => setDisburseReference(e.target.value)}
              />
            </div>

            <label className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-3 cursor-pointer">
              <Checkbox
                checked={disburseAgree}
                onCheckedChange={(v) => setDisburseAgree(Boolean(v))}
                className="mt-0.5"
              />
              <span className="text-xs text-amber-900">
                I confirm the manual bank transfer of <strong>{formatNGN(b.total_amount_ngn - (b.escrow_fee_ngn ?? 0))}</strong> has been sent
                to the landlord's account above and the receipt is on file.
              </span>
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" disabled={disburseBusy} onClick={() => setDisburseOpen(false)}>Cancel</Button>
            <Button
              style={{ background: "#16A34A", color: "#fff", border: "none" }}
              disabled={disburseBusy || !disburseAgree}
              onClick={submitDisburse}
            >
              {disburseBusy ? "Disbursing…" : "Confirm disbursement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ParticipantCard({
  title, name, email, phone, verification, profilePhotoUrl, trustScore, bankCode, bankAccount, bankAccountName,
}: {
  title: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  verification?: string | null;
  profilePhotoUrl?: string | null;
  trustScore?: number;
  bankCode?: string | null;
  bankAccount?: string | null;
  bankAccountName?: string | null;
}) {
  return (
    <div className="bg-white border border-[#EBEBEB] rounded-xl p-4">
      <div className="flex items-center gap-3 mb-2">
        {profilePhotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profilePhotoUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
        ) : (
          <div className="h-10 w-10 rounded-full bg-[#F3F4F6]" />
        )}
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{title}</div>
          <div className="font-medium">{name}</div>
        </div>
        {verification && (
          <Badge className="ml-auto border-0" style={{
            background: verification === "verified" ? "#DCFCE7" : "#FEF3C7",
            color: verification === "verified" ? "#15803D" : "#B45309",
          }}>
            {verification}
          </Badge>
        )}
      </div>
      <div className="text-xs text-muted-foreground space-y-0.5">
        {email && <div>{email}</div>}
        {phone && <div>{phone}</div>}
        {trustScore != null && <div>Trust score: <span className="font-medium text-foreground">{trustScore}</span></div>}
      </div>
      {title === "Landlord" && (
        <div className="mt-3 text-xs bg-blue-50 border border-blue-100 rounded-md p-2">
          <div className="text-blue-900 font-medium mb-0.5">Payout bank</div>
          {bankAccount ? (
            <div className="font-mono text-blue-900">{bankAccount} · {bankAccountName}</div>
          ) : (
            <div className="text-amber-700">Not set</div>
          )}
        </div>
      )}
    </div>
  );
}
