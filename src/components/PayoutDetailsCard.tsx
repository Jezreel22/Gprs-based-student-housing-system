"use client";

import { useEffect, useState } from "react";
import { customFetch } from "@/api/custom-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Wallet, CheckCircle2, AlertCircle } from "lucide-react";

interface Bank { name: string; code: string; }
interface PayoutDetails {
  bank_code: string | null;
  account_number: string | null;
  account_name: string | null;
  recipient_code: string | null;
  set_at: string | null;
}

type Mode = "loading" | "set" | "form" | "preview";

/**
 * Landlord/agent payout-details card. Money from a released booking is sent to
 * the bank account saved here (via a Paystack transfer recipient). Two-step,
 * server-authoritative: enter bank + account number → we show the resolved
 * account name from Paystack → you confirm it's yours → we save.
 *
 * Without payout details on file, escrow release can't complete.
 */
export default function PayoutDetailsCard() {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("loading");
  const [banks, setBanks] = useState<Bank[]>([]);
  const [saved, setSaved] = useState<PayoutDetails | null>(null);

  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [resolvedName, setResolvedName] = useState("");
  const [bankName, setBankName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [b, d] = await Promise.all([
          customFetch<{ data: Bank[] }>("/api/banks"),
          customFetch<PayoutDetails>("/api/users/me/payout-details"),
        ]);
        if (cancelled) return;
        setBanks(b.data ?? []);
        setSaved(d);
        setMode(d.recipient_code ? "set" : "form");
      } catch {
        if (!cancelled) setMode("form");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const reset = () => {
    setBankCode(""); setAccountNumber(""); setResolvedName(""); setBankName("");
    setMode(saved?.recipient_code ? "set" : "form");
  };

  // Step 1: resolve the account (preview the registered name).
  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!bankCode || accountNumber.length !== 10) {
      toast({ variant: "destructive", title: "Enter your bank and 10-digit account number" });
      return;
    }
    setBusy(true);
    try {
      const res = await customFetch<{ account_name: string }>(
        "/api/users/me/payout-details",
        { method: "POST", body: JSON.stringify({ bank_code: bankCode, account_number: accountNumber }) },
      );
      setResolvedName(res.account_name);
      setBankName(banks.find(b => b.code === bankCode)?.name ?? bankCode);
      setMode("preview");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Couldn't verify account", description: err?.message ?? "Check the details and try again" });
    } finally {
      setBusy(false);
    }
  }

  // Step 2: confirm + save (mint the transfer recipient).
  async function handleConfirm() {
    setBusy(true);
    try {
      await customFetch("/api/users/me/payout-details", {
        method: "POST",
        body: JSON.stringify({ bank_code: bankCode, account_number: accountNumber, account_name: resolvedName, confirm: true }),
      });
      const d = await customFetch<PayoutDetails>("/api/users/me/payout-details");
      setSaved(d);
      setMode("set");
      toast({ title: "Payout details saved", description: "Escrow releases will be sent to this account." });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Save failed", description: err?.message ?? "Please try again" });
    } finally {
      setBusy(false);
    }
  }

  if (mode === "loading") {
    return (
      <div className="bg-white rounded-2xl border border-[#EBEBEB] p-5 flex items-center gap-3">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading payout details…</span>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-[#EBEBEB] p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "#FFF0F0" }}>
            <Wallet className="h-5 w-5" style={{ color: "#FF5A5F" }} />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Payout details</h3>
            <p className="text-xs text-muted-foreground">Where escrow releases are sent</p>
          </div>
        </div>
        {mode === "set" && (
          <Button variant="outline" size="sm" onClick={() => { setBankCode(saved?.bank_code ?? ""); setAccountNumber(saved?.account_number ?? ""); setMode("form"); }}>
            Edit
          </Button>
        )}
      </div>

      {/* Saved state */}
      {mode === "set" && saved?.recipient_code && (
        <div className="flex items-start gap-2 text-sm">
          <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">{saved.account_name}</p>
            <p className="text-muted-foreground">
              {banks.find(b => b.code === saved.bank_code)?.name ?? "Bank"} ••••{saved.account_number?.slice(-4)}
            </p>
          </div>
        </div>
      )}

      {/* Form (enter / edit) */}
      {mode === "form" && (
        <form onSubmit={handleVerify} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Bank</Label>
            <Select value={bankCode} onValueChange={setBankCode}>
              <SelectTrigger className="h-10"><SelectValue placeholder="Select your bank" /></SelectTrigger>
              <SelectContent>
                {banks.map(b => <SelectItem key={b.code} value={b.code}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Account number (10 digits)</Label>
            <Input
              value={accountNumber}
              onChange={e => setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
              inputMode="numeric"
              placeholder="0123456789"
              className="h-10"
            />
          </div>
          <Button type="submit" disabled={busy} className="w-full" style={{ background: "#FF5A5F", color: "#fff", border: "none" }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify account"}
          </Button>
        </form>
      )}

      {/* Preview (resolved name → confirm) */}
      {mode === "preview" && (
        <div className="space-y-3">
          <div className="rounded-xl bg-[#FAFAFA] border border-[#EBEBEB] p-3">
            <p className="text-xs text-muted-foreground mb-0.5">Account name on file</p>
            <p className="font-semibold text-sm">{resolvedName}</p>
            <p className="text-xs text-muted-foreground mt-1">{bankName} ••••{accountNumber.slice(-4)}</p>
          </div>
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Confirm this is your account. Escrow releases go here.</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={reset} disabled={busy}>Back</Button>
            <Button className="flex-1" disabled={busy} onClick={handleConfirm} style={{ background: "#FF5A5F", color: "#fff", border: "none" }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm & Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
