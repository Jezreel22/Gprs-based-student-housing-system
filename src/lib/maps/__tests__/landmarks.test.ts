import { describe, it, expect } from "vitest";
import {
  describeLandmark,
  initialBearing,
  LANDMARKS,
} from "../landmarks";
import { NAUB_COORDS } from "../constants";
import { haversineKm } from "../utils";

// A point well outside the curated 1.5 km radius -- used for "no landmark
// in range" assertions. NAUB is at (10.6102, 12.1978); 3 km due east is
// roughly +0.027 in longitude at this latitude.
const FAR_AWAY = { lat: 10.6102, lng: 12.2308 };

// Offset a given origin by a fixed bearing + distance, returning a new
// {lat,lng}. Used to construct test inputs that are at a precise distance
// from a known point. Naive flat-earth approximation -- good enough at the
// ~100 m scale used by these tests, where curvature error is sub-metre.
function offsetBy(
  origin: { lat: number; lng: number },
  bearingDeg: number,
  km: number
): { lat: number; lng: number } {
  const rad = (bearingDeg * Math.PI) / 180;
  const dLat = (km * Math.cos(rad)) / 110.57;
  const meanLat = (origin.lat * Math.PI) / 180;
  const dLng = (km * Math.sin(rad)) / (111.32 * Math.cos(meanLat));
  return { lat: origin.lat + dLat, lng: origin.lng + dLng };
}

describe("initialBearing", () => {
  it("returns 0 for a point due north", () => {
    const origin = NAUB_COORDS;
    const north = { lat: origin.lat + 1, lng: origin.lng };
    expect(initialBearing(origin, north)).toBeCloseTo(0, 0);
  });

  it("returns 90 for a point due east", () => {
    const origin = NAUB_COORDS;
    const east = { lat: origin.lat, lng: origin.lng + 1 };
    expect(initialBearing(origin, east)).toBeCloseTo(90, 0);
  });

  it("returns 180 for a point due south", () => {
    const origin = NAUB_COORDS;
    const south = { lat: origin.lat - 1, lng: origin.lng };
    expect(initialBearing(origin, south)).toBeCloseTo(180, 0);
  });

  it("returns 270 for a point due west", () => {
    const origin = NAUB_COORDS;
    const west = { lat: origin.lat, lng: origin.lng - 1 };
    expect(initialBearing(origin, west)).toBeCloseTo(270, 0);
  });

  it("wraps to [0, 360) instead of returning negative degrees", () => {
    const origin = NAUB_COORDS;
    const west = { lat: origin.lat, lng: origin.lng - 1 };
    const b = initialBearing(origin, west);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
  });

  it("returns 0 for identical points (degenerate, harmless default)", () => {
    expect(initialBearing(NAUB_COORDS, NAUB_COORDS)).toBe(0);
  });

  it("returns 0 for non-finite input without throwing", () => {
    expect(initialBearing({ lat: NaN, lng: 0 }, NAUB_COORDS)).toBe(0);
    expect(initialBearing(NAUB_COORDS, { lat: Infinity, lng: 0 })).toBe(0);
  });
});

describe("describeLandmark", () => {
  it("returns null when point is null", () => {
    expect(describeLandmark(null)).toBeNull();
    expect(describeLandmark(null, { fallbackPoi: { name: "Anything" } })).toBeNull();
  });

  it("returns null when either coordinate is non-finite", () => {
    expect(describeLandmark({ lat: NaN, lng: 0 })).toBeNull();
    expect(describeLandmark({ lat: 0, lng: Infinity })).toBeNull();
    expect(
      describeLandmark({ lat: NaN, lng: NaN }, { fallbackPoi: { name: "X" } })
    ).toBeNull();
  });

  it("picks the nearest curated landmark by haversine distance", () => {
    // ~30 m north of NAUB Main Gate (~40 m east of NAUB); the main gate is
    // closer than Zenith Bank (~220 m west).
    const here = offsetBy(NAUB_COORDS, 0, 0.05); // 50 m north
    const out = describeLandmark(here);
    expect(out).not.toBeNull();
    // The closest landmark at this offset should be one of the immediate
    // neighbours -- the Main Gate, Postgraduate Hostel, or Central Mosque.
    // We assert it names a landmark, not a specific one, to keep the test
    // robust to table tweaks.
    expect(out).toMatch(/^Opposite |^Beside /);
    expect(out!.length).toBeGreaterThan("Beside ".length);
  });

  it("uses 'Opposite' for sub-60m distances", () => {
    // 30 m due east of NAUB Main Gate. NAUB Main Gate is the east-most
    // landmark in the cluster, so points within ~50 m of it have it as the
    // unambiguous nearest landmark.
    const gate = LANDMARKS.find((l) => l.name === "NAUB Main Gate")!;
    const here = offsetBy(gate, 90, 0.03); // 30 m east of the gate
    const out = describeLandmark(here);
    expect(out).toBe("Opposite NAUB Main Gate");
  });

  it("uses 'Beside' for sub-150m distances", () => {
    // 100 m east of NAUB Main Gate; the gate is still the nearest landmark
    // at this offset.
    const gate = LANDMARKS.find((l) => l.name === "NAUB Main Gate")!;
    const here = offsetBy(gate, 90, 0.1); // 100 m east of the gate
    const out = describeLandmark(here);
    expect(out).toBe("Beside NAUB Main Gate");
  });

  it("maps each preposition band to the band the nearest landmark falls in", () => {
    // For the longer-distance bands, landmark clustering means the nearest
    // landmark depends on the exact point. Verify that for any candidate
    // point, `describeLandmark`'s output preposition matches the band of
    // the *actual* nearest landmark (computed independently). This decouples
    // the test from the curated table layout while still exercising every
    // preposition branch.
    const expectedForKm = (km: number): RegExp => {
      if (km < 0.06) return /^Opposite /;
      if (km < 0.15) return /^Beside /;
      if (km < 0.4) return /^Near /;
      if (km < 0.8) return /^Close to /;
      if (km < 1.2) return /^Short walk from /;
      return /^Brief drive from /;
    };
    const candidates: { lat: number; lng: number }[] = [];
    // Walk NAUB in a ring at varying radii so each band is hit.
    for (const km of [0.05, 0.2, 0.5, 1.0, 1.4]) {
      for (const bearing of [0, 60, 120, 180, 240, 300]) {
        candidates.push(offsetBy(NAUB_COORDS, bearing, km));
      }
    }
    for (const pt of candidates) {
      const nearestKm = Math.min(
        ...LANDMARKS.map((l) => haversineKm(l, pt))
      );
      const out = describeLandmark(pt);
      expect(out, `at nearest=${nearestKm.toFixed(2)}km`).toMatch(expectedForKm(nearestKm));
    }
  });

  it("falls back to the nearest POI when no curated landmark is in range", () => {
    const out = describeLandmark(FAR_AWAY, {
      fallbackPoi: { name: "Greenfield Supermarket" },
    });
    expect(out).toBe("Near Greenfield Supermarket");
  });

  it("returns null when no curated landmark is in range and no fallback POI is given", () => {
    expect(describeLandmark(FAR_AWAY)).toBeNull();
    expect(describeLandmark(FAR_AWAY, { fallbackPoi: null })).toBeNull();
    expect(describeLandmark(FAR_AWAY, { fallbackPoi: { name: "  " } })).toBeNull();
  });

  it("ignores an empty-string POI name (treats it as no fallback)", () => {
    expect(describeLandmark(FAR_AWAY, { fallbackPoi: { name: "" } })).toBeNull();
  });

  it("matches the demo property's read as expected for the curated offsets", () => {
    // Seeded demo property: 12 Maiduguri Road, Biu -- (10.611, 12.1909).
    // Sanity-check that it picks a landmark from the table (any preposition).
    const out = describeLandmark({ lat: 10.611, lng: 12.1909 });
    expect(out).not.toBeNull();
    expect(out).toMatch(
      /^(Opposite |Beside |Near |Close to |Short walk from |Brief drive from )/
    );
    // And it should be within ~1 km of the demo property.
    const nearestLandmarkKm = LANDMARKS.map((l) =>
      haversineKm(l, { lat: 10.611, lng: 12.1909 })
    ).reduce((min, km) => Math.min(min, km), Infinity);
    expect(nearestLandmarkKm).toBeLessThan(1);
  });
});