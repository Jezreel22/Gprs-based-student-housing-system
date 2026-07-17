export const TRUST_BASELINE = 50;
export const TRUST_MIN = 0;
export const TRUST_MAX = 100;

export type TrustLevel = "highly_trusted" | "trusted" | "average" | "low_trust" | "high_risk";

export function clampTrustScore(score: number): number {
  return Math.max(TRUST_MIN, Math.min(TRUST_MAX, Math.round(score)));
}

export function trustLevelForScore(score: number): TrustLevel {
  if (score >= 90) return "highly_trusted";
  if (score >= 70) return "trusted";
  if (score >= 50) return "average";
  if (score >= 30) return "low_trust";
  return "high_risk";
}

export function trustLevelLabel(level: TrustLevel): string {
  return {
    highly_trusted: "Highly Trusted",
    trusted: "Trusted",
    average: "Average",
    low_trust: "Low Trust",
    high_risk: "High Risk",
  }[level];
}
