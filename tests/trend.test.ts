import { describe, expect, it } from "vitest";

import { computeTrend, dailyVolume, pctChange } from "~/lib/engine";
import type { NormalizedMessage } from "~/lib/types";

const now = new Date("2026-06-01T00:00:00Z");

describe("trend", () => {
  it("handles pctChange edge cases", () => {
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(0, 3)).toBe(1);
    expect(pctChange(2, 3)).toBe(0.5);
  });

  it("computes rising recent trend", () => {
    const timestamps = [
      new Date("2026-05-20T00:00:00Z"),
      new Date("2026-05-28T00:00:00Z"),
      new Date("2026-05-29T00:00:00Z"),
    ];
    expect(computeTrend(timestamps, now, 7)).toBeGreaterThan(0);
  });

  it("buckets daily volume", () => {
    const messages: NormalizedMessage[] = [
      { id: "1", content: "a", occurredAt: now, source: "test" },
    ];
    const points = dailyVolume(messages, now, 7);
    expect(points).toHaveLength(7);
    expect(points.at(-1)?.count).toBe(1);
  });
});
