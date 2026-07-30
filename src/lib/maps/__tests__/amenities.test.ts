import { describe, it, expect } from "vitest";
import {
  AMENITY_CATEGORIES,
  AMENITY_SCORE_TARGET,
  amenityScore,
  formatAmenityDistance,
} from "../amenities";
import { computeProximityScore } from "../proximity-score";

describe("formatAmenityDistance", () => {
  it("renders metres below 1 km", () => {
    expect(formatAmenityDistance(35)).toBe("35 m");
    expect(formatAmenityDistance(450)).toBe("450 m");
    expect(formatAmenityDistance(999.4)).toBe("999 m");
  });

  it("renders kilometres above 1 km with one decimal", () => {
    expect(formatAmenityDistance(1000)).toBe("1.0 km");
    expect(formatAmenityDistance(1200)).toBe("1.2 km");
    expect(formatAmenityDistance(1834)).toBe("1.8 km");
  });

  it("renders an em-dash for invalid input", () => {
    expect(formatAmenityDistance(NaN)).toBe("—");
    expect(formatAmenityDistance(-5)).toBe("—");
  });
});

describe("amenityScore", () => {
  it("returns 0 when no categories are present", () => {
    expect(amenityScore({})).toBe(0);
  });

  it("returns 0 when categories are present but empty", () => {
    expect(amenityScore({ groceries: [], schools: [] })).toBe(0);
  });

  it("reaches 1.0 at AMENITY_SCORE_TARGET distinct non-empty categories", () => {
    const cats = AMENITY_CATEGORIES.slice(0, AMENITY_SCORE_TARGET).map((c) => c.key);
    const arg = Object.fromEntries(cats.map((k) => [k, [{}]])); // 1 fake place each
    expect(amenityScore(arg)).toBe(1);
  });

  it("is monotonic in the number of distinct categories", () => {
    const a = amenityScore({ groceries: [{}], schools: [{}] });
    const b = amenityScore({ groceries: [{}], schools: [{}], health: [{}] });
    const c = amenityScore({
      groceries: [{}], schools: [{}], health: [{}], transit: [{}], bank: [{}],
    });
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });

  it("counts number-of-places, not length-checks", () => {
    // Five places in one category should still cap at 1, not 5.
    const result = amenityScore({ groceries: [{}, {}, {}, {}, {}] });
    expect(result).toBe(1 / AMENITY_SCORE_TARGET);
  });

  it("accepts a pre-aggregated count record", () => {
    expect(amenityScore({ groceries: 2, schools: 1, health: 0 })).toBeCloseTo(
      2 / AMENITY_SCORE_TARGET,
      10
    );
  });

  it("doesn't break the 0–100 span when fed into computeProximityScore", () => {
    // The Feature 3 contract: feeding amenityScore in must keep the score
    // inside [0, 100] and (at full coverage) push it higher than the omitted
    // baseline. Feature 4 owes this guarantee.
    const base = {
      distanceFromNaubKm: 2,
      gpsVerified: false,
      landlordVerified: true,
      averageRating: 3,
    };
    const omitted = computeProximityScore(base);
    const withZero = computeProximityScore({ ...base, amenityScore: amenityScore({}) });
    const withHalf = computeProximityScore({
      ...base,
      amenityScore: amenityScore({ groceries: [{}], schools: [{}], health: [{}] }),
    });
    const withFull = computeProximityScore({
      ...base,
      amenityScore: amenityScore(
        Object.fromEntries(
          AMENITY_CATEGORIES.slice(0, AMENITY_SCORE_TARGET).map((c) => [c.key, [{}]])
        )
      ),
    });
    for (const r of [omitted, withZero, withHalf, withFull]) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
    // Full amenities is strictly better than half, which is strictly better
    // than zero (zero still adds an empty 5-pt row, so it sits slightly above
    // omitted; both are essentially "no amenity contribution").
    expect(withFull.score).toBeGreaterThan(withHalf.score);
    expect(withHalf.score).toBeGreaterThan(withZero.score);
    // Full coverage is strictly better than omitting the slot entirely.
    expect(withFull.score).toBeGreaterThan(omitted.score);
  });
});

describe("AMENITY_CATEGORIES", () => {
  it("has unique keys", () => {
    const keys = AMENITY_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every entry has a non-empty label and query", () => {
    for (const c of AMENITY_CATEGORIES) {
      expect(c.key.length).toBeGreaterThan(0);
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.query.length).toBeGreaterThan(0);
    }
  });

  it("stays at a small, bounded count (one Mapbox call per category)", () => {
    // Soft guard: blowing past ~15 would dramatically affect the
    // per-cold-request fan-out cost.
    expect(AMENITY_CATEGORIES.length).toBeLessThanOrEqual(15);
  });
});
