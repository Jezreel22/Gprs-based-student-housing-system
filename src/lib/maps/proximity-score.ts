/**
 * lib/maps/proximity-score.ts
 *
 * Campus Proximity Score — a 0–100 "how good is this listing's location for a
 * NAUB student?" metric. Pure and deterministic so the server and client
 * compute the exact same value from the same inputs (no SQL duplication).
 *
 * Weighted components (weights sum to 100 with the amenities slot, 95 without):
 *
 *   distance        35  — straight-line distance to the NAUB campus. Dominant
 *                         weight; exponential decay with a 2 km scale, floored
 *                         at 2 pts so an off-campus listing is never zero.
 *   walk            20  — estimated walking time: full marks ≤ 10 min, zero
 *                         from 60 min, linear between.
 *   drive           10  — estimated driving time: full marks ≤ 5 min, zero
 *                         from 30 min. Doubles as the road-accessibility
 *                         signal (a listing that's slow to drive to is poorly
 *                         connected) until real Directions data lands.
 *   gpsVerified     10  — the listing's pin has been verified by an officer
 *                         (properties.geolocation_verified_at). Zero until the
 *                         GPS verification feature populates it.
 *   landlordVerified 10 — landlord passed KYC verification.
 *   rating          10  — student rating average on a 0–5 scale, linear.
 *                         Unknown rating scores the neutral midpoint (5) so
 *                         new-but-legitimate listings aren't buried.
 *   amenities        5  — nearby POIs (hospitals, ATMs, markets…). Optional
 *                         input (0–1); omitted until the nearby-amenities
 *                         feature supplies it, in which case its weight is
 *                         renormalised into the rest so the score still spans
 *                         the full 0–100 range.
 *
 * Classification: Excellent ≥ 80 · Good ≥ 60 · Average ≥ 40 · Poor < 40.
 */

import { estimateWalkMinutes, estimateDriveMinutes } from "./travel";

export type ProximityClassification = "excellent" | "good" | "average" | "poor";

export interface ProximityScoreInput {
  /** Straight-line km to NAUB; null/undefined when the listing has no pin. */
  distanceFromNaubKm?: number | null;
  /** Pre-computed minutes; derived from distance when omitted. */
  walkMinutes?: number;
  driveMinutes?: number;
  gpsVerified: boolean;
  landlordVerified: boolean;
  /** 0–5 average student rating; null = unrated (neutral midpoint). */
  averageRating?: number | null;
  /** 0–1 nearby-amenity index (Feature 4); omit to renormalise its weight. */
  amenityScore?: number;
}

export interface ProximityScoreResult {
  /** 0–100, rounded. */
  score: number;
  classification: ProximityClassification;
  /** Human label, e.g. "Excellent". */
  label: string;
  /** Foreground colour for badge text. */
  color: string;
  /** Badge background. */
  bg: string;
}

export const PROXIMITY_WEIGHTS = {
  distance: 35,
  walk: 20,
  drive: 10,
  gpsVerified: 10,
  landlordVerified: 10,
  rating: 10,
  amenities: 5,
} as const;

export const PROXIMITY_CLASSIFICATIONS: Record<
  ProximityClassification,
  { label: string; color: string; bg: string; min: number }
> = {
  excellent: { label: "Excellent", color: "#15803D", bg: "#DCFCE7", min: 80 },
  good:      { label: "Good",      color: "#1D4ED8", bg: "#DBEAFE", min: 60 },
  average:   { label: "Average",   color: "#B45309", bg: "#FEF3C7", min: 40 },
  poor:      { label: "Poor",      color: "#B91C1C", bg: "#FEE2E2", min: 0 },
};

export function classificationFor(score: number): ProximityClassification {
  if (score >= PROXIMITY_CLASSIFICATIONS.excellent.min) return "excellent";
  if (score >= PROXIMITY_CLASSIFICATIONS.good.min) return "good";
  if (score >= PROXIMITY_CLASSIFICATIONS.average.min) return "average";
  return "poor";
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

// Distance → points: exponential decay, 2 km scale, 2-pt floor.
function distancePoints(km: number): number {
  return Math.max(2, PROXIMITY_WEIGHTS.distance * Math.exp(-km / 2));
}

// Walk minutes → points: full ≤ 10 min, zero ≥ 60 min, linear between.
function walkPoints(minutes: number): number {
  return PROXIMITY_WEIGHTS.walk * clamp01(1 - Math.max(0, minutes - 10) / 50);
}

// Drive minutes → points: full ≤ 5 min, zero ≥ 30 min, linear between.
function drivePoints(minutes: number): number {
  return PROXIMITY_WEIGHTS.drive * clamp01(1 - Math.max(0, minutes - 5) / 25);
}

/**
 * Compute the score. Walk/drive minutes are derived from the distance when not
 * supplied (heuristic estimates — the same ones the cards display).
 */
export function computeProximityScore(input: ProximityScoreInput): ProximityScoreResult {
  const km = input.distanceFromNaubKm;
  const walk = input.walkMinutes ?? (km != null ? estimateWalkMinutes(km) : null);
  const drive = input.driveMinutes ?? (km != null ? estimateDriveMinutes(km) : null);

  const parts: Array<{ weight: number; points: number }> = [
    { weight: PROXIMITY_WEIGHTS.distance, points: km != null && km >= 0 ? distancePoints(km) : 0 },
    { weight: PROXIMITY_WEIGHTS.walk, points: walk != null ? walkPoints(walk) : 0 },
    { weight: PROXIMITY_WEIGHTS.drive, points: drive != null ? drivePoints(drive) : 0 },
    { weight: PROXIMITY_WEIGHTS.gpsVerified, points: input.gpsVerified ? PROXIMITY_WEIGHTS.gpsVerified : 0 },
    { weight: PROXIMITY_WEIGHTS.landlordVerified, points: input.landlordVerified ? PROXIMITY_WEIGHTS.landlordVerified : 0 },
    {
      weight: PROXIMITY_WEIGHTS.rating,
      // Unrated → neutral midpoint so new listings aren't penalised.
      points: input.averageRating != null
        ? PROXIMITY_WEIGHTS.rating * clamp01(input.averageRating / 5)
        : PROXIMITY_WEIGHTS.rating / 2,
    },
  ];

  // Amenities are optional: when supplied they earn their 5-pt weight, when
  // absent the weight is renormalised across the rest (score still spans 0–100).
  if (input.amenityScore != null) {
    parts.push({
      weight: PROXIMITY_WEIGHTS.amenities,
      points: PROXIMITY_WEIGHTS.amenities * clamp01(input.amenityScore),
    });
  }

  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  const earned = parts.reduce((sum, p) => sum + p.points, 0);
  const score = totalWeight > 0 ? Math.round((earned / totalWeight) * 100) : 0;

  const classification = classificationFor(score);
  const { label, color, bg } = PROXIMITY_CLASSIFICATIONS[classification];
  return { score, classification, label, color, bg };
}
