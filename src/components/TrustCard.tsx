"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Star, ShieldCheck, TrendingUp, ArrowRight } from "lucide-react";
import { getGetUserTrustScoreQueryOptions } from "@/api";
import type { TrustScore } from "@/api";
import TrustBadge from "./TrustBadge";

interface TrustCardProps {
  userId: string;
  role?: string;
  verificationStatus?: string;
  compact?: boolean;
}

// Same 5-stop ramp TrustBadge uses, kept here for the progress bar fill.
function scoreColor(score: number): string {
  if (score >= 90) return "#2E7D32";
  if (score >= 70) return "#1565C0";
  if (score >= 50) return "#9A6700";
  if (score >= 30) return "#C2410C";
  return "#C62828";
}

function BreakdownRow({ label, value }: { label: string; value: number }) {
  if (!value) return null;
  const positive = value > 0;
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={`text-xs font-semibold ${positive ? "text-green-600" : "text-red-600"}`}
      >
        {positive ? "+" : ""}{value}
      </span>
    </div>
  );
}

/**
 * "Your Trust Score" — shown on the dashboard so every user can see their own
 * score, how it breaks down, and what they can do to raise it. Reads the same
 * `GET /api/users/[id]/trust-score` the property page uses for landlords.
 */
export default function TrustCard({ userId, role, verificationStatus, compact }: TrustCardProps) {
  const { data: trust, isLoading } = useQuery(getGetUserTrustScoreQueryOptions(userId));

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-[#EBEBEB] p-5 animate-pulse h-40" />
    );
  }

  const score = trust?.total_score ?? 50;
  const level = trust?.trust_level ?? "average";
  const color = scoreColor(score);
  const isVerified = verificationStatus === "verified";

  // Breakdown rows — only non-zero buckets render, so an honest picture.
  const breakdown: Array<{ label: string; value: number }> = [
    { label: "Identity & profile", value: trust?.identity_verification_points ?? 0 },
    { label: "Transactions completed", value: trust?.transaction_completion_points ?? 0 },
    { label: "Ratings", value: trust?.ratings_average_points ?? 0 },
    { label: "Property verification", value: trust?.property_verification_points ?? 0 },
    { label: "Tenure bonus", value: trust?.tenure_bonus_points ?? 0 },
    { label: "Deductions", value: trust?.fraud_report_deduction ?? 0 },
  ];

  // "How to improve" — static mapping off role + which signals are missing.
  // No new API; we infer from the breakdown + verification status we already have.
  const hints: Array<{ text: string; href?: string }> = [];
  if (["landlord", "agent"].includes(role ?? "") && !isVerified) {
    hints.push({ text: "Verify your government ID (+20)", href: "/kyc" });
  }
  if (!trust?.transaction_completion_points) {
    hints.push({
      text: role === "student" ? "Complete a booking (+5)" : "Get your first completed booking (+5)",
    });
  }
  if (!trust?.ratings_average_points) {
    hints.push({ text: "Earn a positive review (+2)" });
  }
  if (!trust?.tenure_bonus_points) {
    hints.push({ text: "Accounts earn a +5 bonus after 6 months" });
  }

  return (
    <div className={`bg-white rounded-2xl border border-[#EBEBEB] ${compact ? "p-4" : "p-5"} shadow-sm`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-foreground flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Your Trust Score
        </h3>
        <TrustBadge score={score} size="md" />
      </div>

      <div className="flex items-end gap-2 mb-3">
        <span className="text-3xl font-extrabold" style={{ color }}>{score}</span>
        <span className="text-sm text-muted-foreground mb-1">/ 100</span>
      </div>

      {/* Progress bar */}
      <div className="h-2 rounded-full bg-[#EBEBEB] overflow-hidden mb-4">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${score}%`, background: color }}
        />
      </div>

      {/* Breakdown */}
      <div className="space-y-1.5 mb-4">
        {breakdown.filter((r) => r.value !== 0).length > 0 ? (
          breakdown.map((r) => <BreakdownRow key={r.label} {...r} />)
        ) : (
          <p className="text-xs text-muted-foreground">
            No scoring activity yet — complete verification and a booking to build your score.
          </p>
        )}
      </div>

      {/* Quick stats */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4 pb-4 border-b border-[#EBEBEB]">
        <span className="flex items-center gap-1">
          <Star className="h-3 w-3" />
          {trust?.average_rating ? trust.average_rating.toFixed(1) : "—"} rating
        </span>
        <span>
          {trust?.completed_transactions ?? 0} completed {trust?.completed_transactions === 1 ? "booking" : "bookings"}
        </span>
      </div>

      {/* How to improve */}
      {hints.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-foreground flex items-center gap-1 mb-2">
            <TrendingUp className="h-3.5 w-3.5 text-primary" />
            How to improve
          </p>
          <ul className="space-y-1.5">
            {hints.map((h) => (
              <li key={h.text}>
                {h.href ? (
                  <Link
                    href={h.href}
                    className="flex items-center justify-between text-xs text-foreground hover:text-primary transition-colors group"
                  >
                    {h.text}
                    <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">{h.text}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
