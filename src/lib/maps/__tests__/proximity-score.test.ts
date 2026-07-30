import { describe, it, expect } from "vitest";
import {
  computeProximityScore,
  classificationFor,
  PROXIMITY_CLASSIFICATIONS,
  PROXIMITY_WEIGHTS,
} from "../proximity-score";

describe("classificationFor", () => {
  it("uses the documented thresholds", () => {
    expect(classificationFor(100)).toBe("excellent");
    expect(classificationFor(80)).toBe("excellent");
    expect(classificationFor(79)).toBe("good");
    expect(classificationFor(60)).toBe("good");
    expect(classificationFor(59)).toBe("average");
    expect(classificationFor(40)).toBe("average");
    expect(classificationFor(39)).toBe("poor");
    expect(classificationFor(0)).toBe("poor");
  });

  it("every classification carries a label + colours", () => {
    for (const key of Object.keys(PROXIMITY_CLASSIFICATIONS) as Array<keyof typeof PROXIMITY_CLASSIFICATIONS>) {
      const c = PROXIMITY_CLASSIFICATIONS[key];
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.color).toMatch(/^#[0-9A-F]{6}$/i);
      expect(c.bg).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});

describe("computeProximityScore", () => {
  it("scores a prime listing near campus as Excellent", () => {
    const r = computeProximityScore({
      distanceFromNaubKm: 0.5,
      gpsVerified: true,
      landlordVerified: true,
      averageRating: 5,
    });
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.classification).toBe("excellent");
    expect(r.label).toBe("Excellent");
  });

  it("scores a distant, unverified, unrated listing as Poor", () => {
    const r = computeProximityScore({
      distanceFromNaubKm: 8,
      gpsVerified: false,
      landlordVerified: false,
      averageRating: null,
    });
    expect(r.score).toBeLessThan(40);
    expect(r.classification).toBe("poor");
  });

  it("never returns a zero distance component (2-pt floor)", () => {
    const r = computeProximityScore({
      distanceFromNaubKm: 100, // absurdly far
      gpsVerified: false,
      landlordVerified: false,
      averageRating: null,
    });
    // Floor (2) + rating midpoint (5) out of 95 → at least ~7.
    expect(r.score).toBeGreaterThanOrEqual(7);
  });

  it("a listing with no pin loses all location components", () => {
    const r = computeProximityScore({
      distanceFromNaubKm: null,
      gpsVerified: false,
      landlordVerified: true,
      averageRating: null,
    });
    // Only landlordVerified (10) + rating midpoint (5) out of 95 → ~16.
    expect(r.score).toBe(16);
    expect(r.classification).toBe("poor");
  });

  it("renormalises when the amenity slot is omitted", () => {
    const base = {
      distanceFromNaubKm: 2,
      gpsVerified: false,
      landlordVerified: true,
      averageRating: 3,
    };
    const without = computeProximityScore(base);
    const withFull = computeProximityScore({ ...base, amenityScore: 1 });
    const withNone = computeProximityScore({ ...base, amenityScore: 0 });
    // Full amenities beats omitted, which beats zero amenities.
    expect(withFull.score).toBeGreaterThan(without.score);
    expect(without.score).toBeGreaterThan(withNone.score);
    // All within 0–100.
    for (const r of [without, withFull, withNone]) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });

  it("explicit walk/drive minutes override the derived estimates", () => {
    const derived = computeProximityScore({
      distanceFromNaubKm: 3,
      gpsVerified: false,
      landlordVerified: false,
      averageRating: null,
    });
    const fastRoads = computeProximityScore({
      distanceFromNaubKm: 3,
      walkMinutes: 5,   // much faster than the ~45 min heuristic
      driveMinutes: 3,
      gpsVerified: false,
      landlordVerified: false,
      averageRating: null,
    });
    expect(fastRoads.score).toBeGreaterThan(derived.score);
  });

  it("unrated listings get the neutral midpoint, not zero", () => {
    const unrated = computeProximityScore({
      distanceFromNaubKm: 1,
      gpsVerified: false,
      landlordVerified: false,
      averageRating: null,
    });
    const zeroRated = computeProximityScore({
      distanceFromNaubKm: 1,
      gpsVerified: false,
      landlordVerified: false,
      averageRating: 0,
    });
    expect(unrated.score).toBeGreaterThan(zeroRated.score);
  });

  it("weights sum to 100 with the amenity slot, 95 without", () => {
    const total = Object.values(PROXIMITY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
    expect(total - PROXIMITY_WEIGHTS.amenities).toBe(95);
  });

  it("is deterministic", () => {
    const a = computeProximityScore({
      distanceFromNaubKm: 1.7,
      gpsVerified: true,
      landlordVerified: false,
      averageRating: 4.2,
    });
    const b = computeProximityScore({
      distanceFromNaubKm: 1.7,
      gpsVerified: true,
      landlordVerified: false,
      averageRating: 4.2,
    });
    expect(a).toEqual(b);
  });
});
