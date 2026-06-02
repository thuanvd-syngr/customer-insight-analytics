import { describe, expect, it } from "vitest";

import { runAnalysis } from "~/lib/engine";
import { buildSampleAnalysisInput } from "~/lib/sample-data";
import type { AnalysisInput } from "~/lib/types";

describe("runAnalysis", () => {
  it("returns populated sample insight", () => {
    const result = runAnalysis(buildSampleAnalysisInput(new Date("2026-06-01T00:00:00Z")));
    expect(result.messageCount).toBeGreaterThan(0);
    expect(result.insightScore).toBeGreaterThanOrEqual(0);
    expect(result.insightScore).toBeLessThanOrEqual(100);
    expect(result.keywordGroups.length).toBeGreaterThan(0);
    expect(result.weeklyTrend).toHaveLength(7);
  });

  it("generates storewide opportunities without product matches", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const input: AnalysisInput = {
      now,
      messages: [
        "How long does shipping take?",
        "Can I pay with PayPal?",
        "What is your return policy?",
        "Do you have a discount code?",
        "When will delivery arrive?",
      ].map((content, index) => ({
        id: `m-${index}`,
        content,
        source: "manual",
        occurredAt: now,
      })),
      products: [
        {
          id: "gid://shopify/Product/1",
          title: "CloudFit Hoodie",
          handle: "cloudfit-hoodie",
          description: "Athletic hoodie",
          tags: ["apparel"],
        },
      ],
    };

    const result = runAnalysis(input);

    expect(result.productConfusion).toHaveLength(0);
    expect(result.contentGaps).toHaveLength(0);
    expect(result.storewideOpportunities.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "STOREWIDE_SHIPPING_GAP",
        "STOREWIDE_PAYMENT_GAP",
        "STOREWIDE_RETURN_GAP",
        "STOREWIDE_DISCOUNT_GAP",
      ]),
    );
    expect(result.revenueOpportunity.drivers.map((item) => item.groupId)).toEqual(
      expect.arrayContaining(["shipping", "payment", "return", "discount"]),
    );
  });

  it("falls back to imported questions when none are inside the 30 day window", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    const result = runAnalysis({
      now,
      windowDays: 30,
      messages: [
        {
          id: "old-question",
          content: "Do you offer free shipping and PayPal payment?",
          source: "manual",
          occurredAt: new Date("2025-01-01T00:00:00Z"),
        },
      ],
      products: [],
    });

    expect(result.messageCount).toBe(1);
    expect(result.questionOpportunities.map((item) => item.groupId)).toEqual(
      expect.arrayContaining(["shipping", "payment"]),
    );
    expect(result.storewideOpportunities.length).toBeGreaterThan(0);
  });
});
