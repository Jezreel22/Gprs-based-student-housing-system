import { ShieldCheck, Shield, AlertTriangle, ShieldAlert } from "lucide-react";

interface TrustBadgeProps { score: number; size?: "sm" | "md" | "lg"; showLabel?: boolean; }

export default function TrustBadge({ score, size = "sm", showLabel = true }: TrustBadgeProps) {
  const config = score >= 90
    ? { bg: "#E8F5E9", color: "#2E7D32", label: "Highly Trusted", Icon: ShieldCheck }
    : score >= 70
      ? { bg: "#E3F2FD", color: "#1565C0", label: "Trusted", Icon: Shield }
      : score >= 50
        ? { bg: "#FFF8E1", color: "#9A6700", label: "Average", Icon: Shield }
        : score >= 30
          ? { bg: "#FFF3E0", color: "#C2410C", label: "Low Trust", Icon: AlertTriangle }
          : { bg: "#FFEBEE", color: "#C62828", label: "High Risk", Icon: ShieldAlert };
  const sizeStyles = { sm: { fontSize: "0.7rem", padding: "2px 8px", gap: "4px" }, md: { fontSize: "0.8rem", padding: "4px 10px", gap: "5px" }, lg: { fontSize: "0.9rem", padding: "6px 14px", gap: "6px" } }[size];
  const iconSize = size === "lg" ? 16 : size === "md" ? 13 : 11;
  return <span className="inline-flex items-center rounded-full font-semibold shrink-0" style={{ background: config.bg, color: config.color, ...sizeStyles }}><config.Icon size={iconSize} style={{ flexShrink: 0 }} />{showLabel ? <span>{score}/100 · {config.label}</span> : <span>{score}</span>}</span>;
}
