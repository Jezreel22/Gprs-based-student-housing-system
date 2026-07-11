import { ShieldCheck, Shield, AlertTriangle } from "lucide-react";

interface TrustBadgeProps {
  score: number;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

export default function TrustBadge({ score, size = "sm", showLabel = true }: TrustBadgeProps) {
  const tier = score >= 70 ? "high" : score >= 40 ? "mid" : "low";

  const config = {
    high: {
      bg: "#E8F5E9", color: "#2E7D32",
      label: "Highly Trusted",
      Icon: ShieldCheck,
    },
    mid: {
      bg: "#FFF8E1", color: "#F57F17",
      label: "Trusted",
      Icon: Shield,
    },
    low: {
      bg: "#FFEBEE", color: "#C62828",
      label: "New Listing",
      Icon: AlertTriangle,
    },
  }[tier];

  const sizeStyles = {
    sm: { fontSize: "0.7rem", padding: "2px 8px", gap: "4px" },
    md: { fontSize: "0.8rem", padding: "4px 10px", gap: "5px" },
    lg: { fontSize: "0.9rem", padding: "6px 14px", gap: "6px" },
  }[size];

  const iconSize = size === "lg" ? 16 : size === "md" ? 13 : 11;

  return (
    <span
      className="inline-flex items-center rounded-full font-semibold shrink-0"
      style={{
        background: config.bg,
        color: config.color,
        ...sizeStyles,
      }}
    >
      <config.Icon size={iconSize} style={{ flexShrink: 0 }} />
      {showLabel && (
        <span>{score}/100 · {config.label}</span>
      )}
      {!showLabel && <span>{score}</span>}
    </span>
  );
}
