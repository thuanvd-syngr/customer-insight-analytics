import { describe, expect, it } from "vitest";

import { detectProductConfusion } from "~/lib/engine";

describe("product confusion", () => {
  it("scores mentioned products", () => {
    const results = detectProductConfusion(
      [
        {
          id: "m1",
          content: "CloudFit Travel Hoodie size chart is unclear and too small",
          occurredAt: new Date("2026-06-01T00:00:00Z"),
          source: "test",
        },
      ],
      [{ id: "p1", title: "CloudFit Travel Hoodie", handle: "cloudfit-travel-hoodie" }],
    );
    expect(results[0]?.mentionCount).toBe(1);
    expect(results[0]?.confusionScore).toBeGreaterThan(0);
  });

  it("omits unmentioned products", () => {
    const results = detectProductConfusion(
      [{ id: "m1", content: "No product here", occurredAt: new Date(), source: "test" }],
      [{ id: "p1", title: "CloudFit Travel Hoodie" }],
    );
    expect(results).toHaveLength(0);
  });
});
