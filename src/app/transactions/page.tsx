"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import NavBar from "@/components/NavBar";
import { TransactionHistoryTable } from "@/components/transactions/TransactionHistoryTable";

export default function MyTransactionsPage() {
  const router = useRouter();
  const [user, setUser] = useState<any | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem("naub_user");
    if (!raw) {
      router.push("/login");
      return;
    }
    try { setUser(JSON.parse(raw)); } catch { router.push("/login"); }
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
            <h1 className="text-2xl font-bold">Transactions</h1>
            <p className="text-sm text-muted-foreground">
              Official receipts for every escrow movement on your bookings. Each receipt is permanently verifiable.
            </p>
          </div>
        </div>
        <TransactionHistoryTable />
      </div>
    </div>
  );
}