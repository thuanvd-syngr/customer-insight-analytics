import { describe, expect, it } from "vitest";

import { buildQuestionOpportunities, buildRevenueOpportunity } from "~/lib/revenue-opportunity.server";
import type { KeywordGroupResult } from "~/lib/types";

function group(overrides: Partial<KeywordGroupResult>): KeywordGroupResult {
  return {
    groupId: "shipping",
    label: "Shipping",
    count: 0,
    uniqueMessages: 0,
    keywords: [],
    trend7: 0,
    trend30: 0,
    frictionWeight: 0.5,
    ...overrides,
  };
}

describe("revenue opportunity engine", () => {
  it("turns friction groups into merchant-facing revenue risk", () => {
    const opportunity = buildRevenueOpportunity([
      group({ groupId: "shipping", label: "Shipping", count: 12, trend7: 1.2 }),
      group({ groupId: "refund", label: "Refund", count: 4, trend7: 0.1 }),
      group({ groupId: "stock", label: "Stock", count: 5, trend7: 0 }),
    ]);

    expect(opportunity.monthlyAtRisk).toBeGreaterThan(0);
    expect(opportunity.headline).toMatch(/\$[\d,]+-\$[\d,]+\/mo estimated opportunity/);
    expect(opportunity.estimatedLow).toBeGreaterThan(0);
    expect(opportunity.estimatedHigh).toBeGreaterThan(opportunity.estimatedLow);
    expect(opportunity.topFriction?.label).toBe("Shipping");
    expect(opportunity.quickWins[0]?.title).toBe("Add Shipping FAQ");
  });

  it("adds severity, suggested action, and revenue impact per question opportunity", () => {
    const [item] = buildQuestionOpportunities([
      group({ groupId: "competitor", label: "Competitor", count: 8, trend7: 0.5 }),
    ]);

    expect(item?.priorityScore).toBeGreaterThan(0);
    expect(item?.highEstimate).toBeGreaterThan(item?.lowEstimate ?? 0);
    expect(item?.revenueImpact).toBeGreaterThan(100);
    expect(item?.suggestedAction).toBe("Add Competitor Comparison Section");
  });

  it("returns safe defaults when no opportunities exist", () => {
    const opportunity = buildRevenueOpportunity([]);

    expect(opportunity).toMatchObject({
      amount: 0,
      currency: "USD",
      monthlyAtRisk: 0,
      headline: "Add customer questions to reveal recovery actions",
      summary: "Add customer questions or sync Shopify data to discover opportunities.",
      topFriction: null,
      quickWins: [],
      opportunities: [],
      alerts: [],
    });
  });
});
