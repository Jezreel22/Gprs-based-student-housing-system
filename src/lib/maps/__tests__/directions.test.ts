import { describe, it, expect } from "vitest";
import {
  buildDirectionsResponse,
  fallbackDirections,
  type MapboxRouteLike,
} from "../directions";

const SAMPLE_ROUTE: MapboxRouteLike = {
  distance: 1_400, // metres → 1.4 km
  duration: 240, // seconds → 4 min
  geometry: {
    coordinates: [
      [12.1978, 10.6102],
      [12.2, 10.615],
      [12.205, 10.62],
    ],
  },
  legs: [
    {
      steps: [
        {
          maneuver: { instruction: "Head north on Maiduguri Road", modifier: "depart" },
          name: "Maiduguri Road",
          distance: 800,
        },
        {
          maneuver: { instruction: "Turn right onto Biu Road", modifier: "right" },
          name: "Biu Road",
          distance: 600,
        },
        {
          // silent step (no instruction) — should be filtered out
          maneuver: { modifier: "straight" },
          distance: 0,
        },
      ],
    },
  ],
};

describe("buildDirectionsResponse", () => {
  it("maps distance and duration to km + minutes with clamping", () => {
    const out = buildDirectionsResponse(SAMPLE_ROUTE, "driving");
    expect(out.distance_km).toBe(1.4);
    expect(out.duration_min).toBe(4);
    expect(out.source).toBe("mapbox");
    expect(out.profile).toBe("driving");
  });

  it("clamps sub-minute durations to 1 min", () => {
    const tiny: MapboxRouteLike = { ...SAMPLE_ROUTE, duration: 12 };
    expect(buildDirectionsResponse(tiny, "walking").duration_min).toBe(1);
  });

  it("passes the geometry coordinates through unchanged (lng,lat order)", () => {
    const out = buildDirectionsResponse(SAMPLE_ROUTE, "walking");
    expect(out.geometry.type).toBe("LineString");
    expect(out.geometry.coordinates).toEqual(SAMPLE_ROUTE.geometry.coordinates);
    // Spot-check the first coordinate: Mapbox delivers [lng, lat].
    expect(out.geometry.coordinates[0]).toEqual([12.1978, 10.6102]);
  });

  it("flattens steps and drops ones without an instruction", () => {
    const out = buildDirectionsResponse(SAMPLE_ROUTE, "driving");
    expect(out.steps).toHaveLength(2);
    expect(out.steps[0]).toMatchObject({
      instruction: "Head north on Maiduguri Road",
      distance_m: 800,
      modifier: "depart",
      name: "Maiduguri Road",
    });
    expect(out.steps[1].modifier).toBe("right");
  });

  it("handles missing legs/empty geometry defensively", () => {
    const empty: MapboxRouteLike = { distance: 0, duration: 0, geometry: { coordinates: [] } };
    const out = buildDirectionsResponse(empty, "walking");
    expect(out.geometry.coordinates).toEqual([]);
    expect(out.steps).toEqual([]);
    expect(out.duration_min).toBe(1); // clamped
  });
});

describe("fallbackDirections", () => {
  it("returns a 2-vertex straight line with the right lng,lat order", () => {
    const out = fallbackDirections(
      { lat: 10.61, lng: 12.2 },
      { lat: 10.62, lng: 12.21 },
      "driving"
    );
    expect(out.source).toBe("estimate");
    expect(out.geometry.coordinates).toEqual([
      [12.2, 10.61],
      [12.21, 10.62],
    ]);
    expect(out.steps).toEqual([]);
  });

  it("uses the heuristic travel-time ETA (walking > driving)", () => {
    const from = { lat: 10.61, lng: 12.2 };
    const to = { lat: 10.62, lng: 12.21 };
    const walk = fallbackDirections(from, to, "walking");
    const drive = fallbackDirections(from, to, "driving");
    expect(walk.duration_min).toBeGreaterThanOrEqual(drive.duration_min);
  });

  it("is monotonic in distance for the same profile", () => {
    const origin = { lat: 10.6, lng: 12.2 };
    const near = { lat: 10.61, lng: 12.2 };
    const far = { lat: 10.62, lng: 12.2 };
    const nearEta = fallbackDirections(origin, near, "walking").duration_min;
    const farEta = fallbackDirections(origin, far, "walking").duration_min;
    expect(farEta).toBeGreaterThanOrEqual(nearEta);
  });

  it("clamps to 1 min on bad input (NaN / null origin or destination)", () => {
    expect(fallbackDirections(null, null, "walking").duration_min).toBe(1);
    expect(fallbackDirections({ lat: NaN, lng: 0 }, { lat: 0, lng: 0 }, "driving").duration_min).toBe(1);
  });
});
