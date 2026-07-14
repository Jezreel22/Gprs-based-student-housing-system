"use client";

import { useEffect, useMemo, useState } from "react";
import { customFetch } from "@/api/custom-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Wallet, CheckCircle2, AlertCircle, ChevronsUpDown, Check } from "lucide-react";

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
 * Major Nigerian banks and fintechs shown first so landlords find them quickly.
 * Codes are Paystack bank codes (https://paystack.com/banks). Other banks from
 * Paystack's full list are still searchable below this list.
 */
const MAJOR_NG_BANK_CODES = [
  "058", // GTBank
  "044", // Access Bank
  "057", // Zenith Bank
  "033", // United Bank for Africa (UBA)
  "011", // First Bank of Nigeria
  "050", // Ecobank Nigeria
  "070", // Fidelity Bank
  "214", // FCMB
  "221", // Stanbic IBTC
  "032", // Union Bank
  "232", // Sterling Bank
  "035", // Wema Bank
  "301", // Jaiz Bank
  "082", // Keystone Bank
  "076", // Polaris Bank
  "215", // Unity Bank
  "50211", // Kuda MFB
  "999992", // OPay
  "999991", // PalmPay
  "50515", // Moniepoint MFB
];

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
  const [bankOpen, setBankOpen] = useState(false);
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

  // Major banks first (in priority order), then everything else alphabetically.
  const sortedBanks = useMemo(() => {
    const byCode = new Map(banks.map((b) => [b.code, b]));
    const head: Bank[] = [];
    for (const code of MAJOR_NG_BANK_CODES) {
      const b = byCode.get(code);
      if (b) head.push(b);
    }
    const tail = banks
      .filter((b) => !MAJOR_NG_BANK_CODES.includes(b.code))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...head, ...tail];
  }, [banks]);

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
      <div className="bg-white rounded-xl border border-[#EBEBEB] p-4 flex items-center gap-2.5">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading payout details…</span>
      </div>
    );
  }

  const selectedBankName = banks.find(b => b.code === bankCode)?.name ?? "";

  return (
    <div className="bg-white rounded-xl border border-[#EBEBEB] p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#FFF0F0" }}>
            <Wallet className="h-4 w-4" style={{ color: "#FF5A5F" }} />
          </div>
          <div>
            <h3 className="font-semibold text-sm leading-tight">Payout details</h3>
            <p className="text-xs text-muted-foreground leading-tight">Where escrow releases are sent</p>
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
            <p className="font-medium leading-tight">{saved.account_name}</p>
            <p className="text-muted-foreground leading-tight">
              {banks.find(b => b.code === saved.bank_code)?.name ?? "Bank"} ••••{saved.account_number?.slice(-4)}
            </p>
          </div>
        </div>
      )}

      {/* Form (enter / edit) */}
      {mode === "form" && (
        <form onSubmit={handleVerify} className="space-y-2.5">
          <div className="space-y-1">
            <Label className="text-xs">Bank</Label>
            <Popover open={bankOpen} onOpenChange={setBankOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  role="combobox"
                  aria-expanded={bankOpen}
                  className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <span className={bankCode ? "" : "text-muted-foreground"}>
                    {selectedBankName || "Select your bank"}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search banks…" />
                  <CommandList>
                    <CommandEmpty>No bank found.</CommandEmpty>
                    {sortedBanks.map((b, i) => {
                      const isMajor = i < MAJOR_NG_BANK_CODES.length;
                      const prevMajor = i > 0 && (i - 1 < MAJOR_NG_BANK_CODES.length);
                      return (
                        <div key={b.code}>
                          {isMajor && prevMajor === false && (
                            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-[#FAFAFA] border-b border-[#EBEBEB]">
                              Popular Nigerian banks
                            </div>
                          )}
                          {!isMajor && prevMajor && (
                            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-[#FAFAFA] border-t border-b border-[#EBEBEB]">
                              All banks
                            </div>
                          )}
                          <CommandItem
                            value={`${b.name} ${b.code}`}
                            onSelect={() => { setBankCode(b.code); setBankOpen(false); }}
                          >
                            <Check className={`mr-2 h-4 w-4 shrink-0 ${bankCode === b.code ? "opacity-100" : "opacity-0"}`} />
                            <span className="flex-1 truncate">{b.name}</span>
                            {isMajor && (
                              <span className="ml-2 text-[10px] font-medium text-[#FF5A5F] bg-[#FFF0F0] px-1.5 py-0.5 rounded shrink-0">Popular</span>
                            )}
                          </CommandItem>
                        </div>
                      );
                    })}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Account number (10 digits)</Label>
            <Input
              value={accountNumber}
              onChange={e => setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
              inputMode="numeric"
              placeholder="0123456789"
              className="h-9"
            />
          </div>
          <Button type="submit" disabled={busy} className="w-full h-9" style={{ background: "#FF5A5F", color: "#fff", border: "none" }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify account"}
          </Button>
        </form>
      )}

      {/* Preview (resolved name → confirm) */}
      {mode === "preview" && (
        <div className="space-y-2.5">
          <div className="rounded-lg bg-[#FAFAFA] border border-[#EBEBEB] p-2.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Account name on file</p>
            <p className="font-semibold text-sm leading-tight">{resolvedName}</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{bankName} ••••{accountNumber.slice(-4)}</p>
          </div>
          <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Confirm this is your account. Escrow releases go here.</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 h-9" onClick={reset} disabled={busy}>Back</Button>
            <Button className="flex-1 h-9" disabled={busy} onClick={handleConfirm} style={{ background: "#FF5A5F", color: "#fff", border: "none" }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm & Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}