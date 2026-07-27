"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import NavBar from "@/components/NavBar";
import { TransactionHistoryTable } from "@/components/transactions/TransactionHistoryTable";

export default function AdminTransactionsPage() {
  const router = useRouter();
  const [user, setUser] = useState<any | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem("naub_user");
    if (!raw) { router.push("/login"); return; }
    try {
      const u = JSON.parse(raw);
      if (u.role !== "escrow_officer") { router.push("/dashboard"); return; }
      setUser(u);
    } catch { router.push("/login"); }
  }, [router]);

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Escrow Transactions</h1>
            <p className="text-sm text-muted-foreground">
              Officer view of every escrow deposit, release, and refund across the platform.
            </p>
          </div>
        </div>
        <TransactionHistoryTable adminMode />
      </div>
    </div>
  );
}