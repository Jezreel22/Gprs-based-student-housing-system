import { AlertTriangle, Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import type { TrustLevel } from "@/lib/trust/levels";

/**
 * Visual config for the five trust levels. Single source of truth so
 * TrustBadge, TrustCard, and PropertyCard stay in lockstep — if we add a
 * level in `lib/trust/levels.ts`, the union type here forces us to handle it.
 *
 * Colors come from the trust badge on the property page; don't change them
 * without checking it still reads well against the white card background.
 */
export interface TrustLevelStyle {
  bg: string;
  color: string;
  Icon: typeof ShieldCheck;
}

export const TRUST_LEVEL_STYLES: Record<TrustLevel, TrustLevelStyle> = {
  highly_trusted: { bg: "#E8F5E9", color: "#2E7D32", Icon: ShieldCheck },
  trusted: { bg: "#E3F2FD", color: "#1565C0", Icon: Shield },
  average: { bg: "#FFF8E1", color: "#9A6700", Icon: Shield },
  low_trust: { bg: "#FFF3E0", color: "#C2410C", Icon: AlertTriangle },
  high_risk: { bg: "#FFEBEE", color: "#C62828", Icon: ShieldAlert },
};