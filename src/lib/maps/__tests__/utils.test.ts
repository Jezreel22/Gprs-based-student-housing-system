import { describe, it, expect } from "vitest";
import { accuracyCircleFeature, formatAccuracy, haversineKm } from "../utils";

// A real point on campus — circle geometry is latitude-sensitive, so tests
// run at NAUB's actual coordinates rather than (0, 0).
const NAUB = { lat: 10.6102, lng: 12.1978 };

describe("accuracyCircleFeature", () => {
  it("builds a closed ring of 65 coordinates (64 vertices + closure)", () => {
    const ring = accuracyCircleFeature(NAUB.lat, NAUB.lng, 500).geometry.coordinates[0];
    expect(ring).toHaveLength(65);
    // Closed exactly — first and last vertex are identical.
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("places every vertex the requested radius from the centre", () => {
    const radiusKm = 0.8;
    const ring = accuracyCircleFeature(NAUB.lat, NAUB.lng, radiusKm * 1000)
      .geometry.coordinates[0];
    for (const [lng, lat] of ring) {
      const d = haversineKm(NAUB, { lat, lng });
      // Same Earth radius on both sides → tolerance can be near-zero.
      expect(Math.abs(d - radiusKm)).toBeLessThan(0.001);
    }
  });

  it("winds the exterior ring counter-clockwise (RFC 7946)", () => {
    // Trapezoid-form shoelace: Σ (x₂−x₁)(y₂+y₁) is negative for a CCW ring
    // in the (lng, lat) plane (it equals −2× the signed area).
    const ring = accuracyCircleFeature(NAUB.lat, NAUB.lng, 300).geometry.coordinates[0];
    let sum = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      sum += (x2 - x1) * (y2 + y1);
    }
    expect(sum).toBeLessThan(0);
  });

  it("returns a valid GeoJSON Feature with null properties", () => {
    const f = accuracyCircleFeature(NAUB.lat, NAUB.lng, 100);
    expect(f.type).toBe("Feature");
    expect(f.geometry.type).toBe("Polygon");
    expect(f.properties).toBeNull();
  });

  it("survives a degenerate zero radius without duplicating points", () => {
    const ring = accuracyCircleFeature(NAUB.lat, NAUB.lng, 0).geometry.coordinates[0];
    expect(ring).toHaveLength(65);
    // 1 m floor → vertices are distinct, not 65 copies of one point.
    expect(ring[0]).not.toEqual(ring[16]);
  });
});

describe("formatAccuracy", () => {
  it("renders metres below 1 km", () => {
    expect(formatAccuracy(35)).toBe("±35 m");
    expect(formatAccuracy(999.4)).toBe("±999 m");
  });

  it("renders kilometres from 1 km up", () => {
    expect(formatAccuracy(1000)).toBe("±1.0 km");
    expect(formatAccuracy(1200)).toBe("±1.2 km");
  });
});
