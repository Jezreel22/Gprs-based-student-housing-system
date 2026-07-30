import { describe, it, expect } from "vitest";
import {
  estimateWalkMinutes,
  estimateDriveMinutes,
  estimateMinutes,
  formatDuration,
} from "../travel";

describe("estimateWalkMinutes", () => {
  it("never returns less than 1", () => {
    expect(estimateWalkMinutes(0)).toBe(1);
    expect(estimateWalkMinutes(0.001)).toBe(1);
  });

  it("rounds to whole minutes at a ~4 km/h effective pace", () => {
    // 0.4 km / 4 km/h * 60 = 6 min
    expect(estimateWalkMinutes(0.4)).toBe(6);
    // 2 km → 30 min
    expect(estimateWalkMinutes(2)).toBe(30);
  });

  it("is monotonic", () => {
    expect(estimateWalkMinutes(1)).toBeLessThanOrEqual(estimateWalkMinutes(2));
    expect(estimateWalkMinutes(2)).toBeLessThan(estimateWalkMinutes(5));
  });

  it("guards against non-finite input", () => {
    expect(estimateWalkMinutes(NaN)).toBe(1);
    expect(estimateWalkMinutes(-3)).toBe(1);
  });
});

describe("estimateDriveMinutes", () => {
  it("rounds to whole minutes at a ~20 km/h effective pace", () => {
    // 1 km / 20 km/h * 60 = 3 min
    expect(estimateDriveMinutes(1)).toBe(3);
    // 5 km → 15 min
    expect(estimateDriveMinutes(5)).toBe(15);
  });

  it("drives faster than it walks for any positive distance", () => {
    for (const km of [0.5, 1, 3, 10]) {
      expect(estimateDriveMinutes(km)).toBeLessThanOrEqual(estimateWalkMinutes(km));
    }
  });
});

describe("estimateMinutes", () => {
  it("routes to the right profile", () => {
    expect(estimateMinutes(2, "walking")).toBe(estimateWalkMinutes(2));
    expect(estimateMinutes(2, "driving")).toBe(estimateDriveMinutes(2));
  });
});

describe("formatDuration", () => {
  it("renders sub-hour durations in minutes", () => {
    expect(formatDuration(1)).toBe("1 min");
    expect(formatDuration(42)).toBe("42 min");
    expect(formatDuration(59)).toBe("59 min");
  });

  it("renders hour durations with a minute remainder", () => {
    expect(formatDuration(60)).toBe("1 hr");
    expect(formatDuration(65)).toBe("1 hr 5 min");
    expect(formatDuration(125)).toBe("2 hr 5 min");
  });

  it("floors tiny / invalid values to the minimum", () => {
    expect(formatDuration(0)).toBe("1 min");
    expect(formatDuration(-5)).toBe("1 min");
    expect(formatDuration(NaN)).toBe("1 min");
  });
});
