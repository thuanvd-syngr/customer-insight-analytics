import { describe, expect, it } from "vitest";

import {
  buildExecutiveSummary,
  buildMonthlyReport,
  buildQuarterlyReport,
  buildROIEstimate,
} from "~/lib/report-export.server";
import { EMPTY_INSIGHT } from "~/lib/types";
import type { InsightResult } from "~/lib/types";

const MOCK_INSIGHT: Partial<InsightResult> = {
  ...EMPTY_INSIGHT,
  insightScore: 72,
  messageCount: 120,
  storewideOpportunities: [
    {
      code: "STOREWIDE_SHIPPING_GAP",
      groupId: "shipping",
      label: "Shipping FAQ Gap",
      severity: "high",
      mentionCount: 15,
      suggestedAction: "Add shipping FAQ",
      lowEstimate: 100,
      highEstimate: 300,
    } as InsightResult["storewideOpportunities"][0],
  ],
  questionOpportunities: [
    {
      groupId: "shipping",
      label: "Shipping",
      count: 15,
      severity: "high",
      revenueImpact: 250,
      lowEstimate: 100,
      highEstimate: 300,
      priorityScore: 80,
      actionType: "faq" as const,
      suggestedAction: "Add shipping FAQ",
      trend7: 0.2,
    },
  ],
  competitors: [
    { name: "Burton", count: 3, exampleQuote: "How does this compare to Burton?" },
  ],
  contentGaps: [
    {
      productId: "gid://shopify/Product/1",
      productTitle: "Test Board",
      mentionCount: 5,
      contentGapScore: 75,
      missingSections: ["Shipping", "Returns"],
      customerQuestions: ["How long does shipping take?"],
      recommendedActions: ["Add shipping FAQ"],
      estimatedLow: 50,
      estimatedHigh: 150,
    } as InsightResult["contentGaps"][0],
  ],
  revenueOpportunity: {
    ...EMPTY_INSIGHT.revenueOpportunity,
    estimatedLow: 333,
    estimatedHigh: 888,
    headline: "Estimated $333–$888/mo at risk from unresolved buying objections.",
    quickWins: [
      {
        groupId: "shipping",
        title: "Add Shipping FAQ",
        action: "Publish a shipping FAQ page",
        impact: "high" as const,
        priorityScore: 80,
        lowEstimate: 100,
        highEstimate: 300,
        ctaLabel: "Create FAQ",
      },
    ],
  } as InsightResult["revenueOpportunity"],
};

describe("buildROIEstimate", () => {
  it("returns all required fields", () => {
    const result = buildROIEstimate(MOCK_INSIGHT as InsightResult, {
      pages: 2,
      blogs: 1,
      productFaqs: 3,
    });
    expect(result.publishedPages).toBe(2);
    expect(result.publishedBlogs).toBe(1);
    expect(result.publishedFaqs).toBe(3);
    expect(result.estimatedConversionLift).toBeGreaterThan(0);
    expect(result.methodology.length).toBeGreaterThan(0);
  });

  it("returns zero recovery when no content published", () => {
    const result = buildROIEstimate(MOCK_INSIGHT as InsightResult, { pages: 0, blogs: 0, productFaqs: 0 });
    expect(result.estimatedMonthlyRecovery).toBe(0);
    expect(result.estimatedAnnualRecovery).toBe(0);
    expect(result.estimatedConversionLift).toBe(0);
  });

  it("annual recovery is 12x monthly", () => {
    const result = buildROIEstimate(MOCK_INSIGHT as InsightResult, { pages: 3, blogs: 2, productFaqs: 1 });
    expect(result.estimatedAnnualRecovery).toBe(result.estimatedMonthlyRecovery * 12);
  });

  it("handles empty insight without throwing", () => {
    const result = buildROIEstimate(EMPTY_INSIGHT as InsightResult, { pages: 5, blogs: 5, productFaqs: 5 });
    expect(result.estimatedMonthlyRecovery).toBe(0);
    expect(result.roiMultiple).toBe(0);
  });
});

describe("buildExecutiveSummary", () => {
  it("returns a concise multi-line string", () => {
    const result = buildExecutiveSummary(MOCK_INSIGHT as InsightResult);
    const lines = result.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(result).toContain("Recovery score:");
    expect(result).toContain("Revenue at risk:");
  });

  it("works on empty insight without throwing", () => {
    const result = buildExecutiveSummary(EMPTY_INSIGHT as InsightResult);
    expect(result).toContain("Recovery score:");
  });
});

describe("buildMonthlyReport", () => {
  it("includes monthly header and period", () => {
    const result = buildMonthlyReport({
      shopDomain: "test.myshopify.com",
      insight: MOCK_INSIGHT as InsightResult,
      monthStart: "2026-05-01",
      monthEnd: "2026-05-31",
    });
    expect(result).toContain("Monthly Revenue Recovery Report");
    expect(result).toContain("2026-05-01");
    expect(result).toContain("test.myshopify.com");
  });

  it("includes storewide gaps section", () => {
    const result = buildMonthlyReport({
      shopDomain: "test.myshopify.com",
      insight: MOCK_INSIGHT as InsightResult,
      monthStart: "2026-05-01",
      monthEnd: "2026-05-31",
    });
    expect(result).toContain("Storewide Gaps");
    expect(result).toContain("Shipping FAQ Gap");
  });

  it("includes ROI section when published counts provided", () => {
    const result = buildMonthlyReport({
      shopDomain: "test.myshopify.com",
      insight: MOCK_INSIGHT as InsightResult,
      monthStart: "2026-05-01",
      monthEnd: "2026-05-31",
      published: { pages: 3, blogs: 2, productFaqs: 5 },
    });
    expect(result).toContain("Published Assets ROI");
    expect(result).toContain("Pages published: 3");
  });

  it("includes competitor threats section", () => {
    const result = buildMonthlyReport({
      shopDomain: "test.myshopify.com",
      insight: MOCK_INSIGHT as InsightResult,
      monthStart: "2026-05-01",
      monthEnd: "2026-05-31",
    });
    expect(result).toContain("Competitor Threats");
    expect(result).toContain("Burton");
  });
});

describe("buildQuarterlyReport", () => {
  it("includes quarterly header and period", () => {
    const result = buildQuarterlyReport({
      shopDomain: "test.myshopify.com",
      insight: MOCK_INSIGHT as InsightResult,
      quarterStart: "2026-01-01",
      quarterEnd: "2026-03-31",
    });
    expect(result).toContain("Quarterly Executive Revenue Recovery Report");
    expect(result).toContain("2026-01-01");
    expect(result).toContain("2026-03-31");
  });

  it("includes executive summary section", () => {
    const result = buildQuarterlyReport({
      shopDomain: "test.myshopify.com",
      insight: MOCK_INSIGHT as InsightResult,
      quarterStart: "2026-01-01",
      quarterEnd: "2026-03-31",
    });
    expect(result).toContain("Executive Summary");
    expect(result).toContain("Revenue at risk:");
  });

  it("includes Q-actions section", () => {
    const result = buildQuarterlyReport({
      shopDomain: "test.myshopify.com",
      insight: MOCK_INSIGHT as InsightResult,
      quarterStart: "2026-01-01",
      quarterEnd: "2026-03-31",
    });
    expect(result).toContain("Q-Actions");
    expect(result).toContain("Add Shipping FAQ");
  });

  it("includes ROI methodology when published counts provided", () => {
    const result = buildQuarterlyReport({
      shopDomain: "test.myshopify.com",
      insight: MOCK_INSIGHT as InsightResult,
      quarterStart: "2026-01-01",
      quarterEnd: "2026-03-31",
      published: { pages: 5, blogs: 3, productFaqs: 8 },
    });
    expect(result).toContain("Published Assets & ROI");
    expect(result).toContain("Methodology:");
  });
});
