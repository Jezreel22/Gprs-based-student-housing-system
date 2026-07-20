import { trustLevelForScore, trustLevelLabel } from "@/lib/trust/levels";
import { TRUST_LEVEL_STYLES } from "./trust-level-styles";

interface TrustBadgeProps { score: number; size?: "sm" | "md" | "lg"; showLabel?: boolean; }

export default function TrustBadge({ score, size = "sm", showLabel = true }: TrustBadgeProps) {
  const style = TRUST_LEVEL_STYLES[trustLevelForScore(score)];
  const sizeStyles = { sm: { fontSize: "0.7rem", padding: "2px 8px", gap: "4px" }, md: { fontSize: "0.8rem", padding: "4px 10px", gap: "5px" }, lg: { fontSize: "0.9rem", padding: "6px 14px", gap: "6px" } }[size];
  const iconSize = size === "lg" ? 16 : size === "md" ? 13 : 11;
  return (
    <span
      className="inline-flex items-center rounded-full font-semibold shrink-0"
      style={{ background: style.bg, color: style.color, ...sizeStyles }}
    >
      <style.Icon size={iconSize} style={{ flexShrink: 0 }} />
      {showLabel
        ? <span>{score}/100 · {trustLevelLabel(trustLevelForScore(score))}</span>
        : <span>{score}</span>}
    </span>
  );
}