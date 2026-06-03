import { describe, expect, it } from "vitest";

import {
  CONTENT_PACKS,
  buildRecoveryPlan,
  buildRevenueTimelineV2,
  calculateRecoveryScoreImprovement,
  scanThemeContent,
} from "~/lib/revenue-automation";
import { EMPTY_INSIGHT, type InsightResult } from "~/lib/types";

function insight(overrides: Partial<InsightResult> = {}): InsightResult {
  return {
    ...EMPTY_INSIGHT,
    insightScore: 31,
    revenueOpportunity: {
      ...EMPTY_INSIGHT.revenueOpportunity,
      monthlyAtRisk: 1781,
      estimatedLow: 900,
      estimatedHigh: 1781,
    },
    questionOpportunities: [
      {
        groupId: "shipping",
        label: "Shipping & Delivery",
        count: 12,
        trend7: 0.2,
        severity: "high",
        revenueImpact: 523,
        lowEstimate: 300,
        highEstimate: 523,
        priorityScore: 91,
        actionType: "faq",
        suggestedAction: "Create shipping FAQ",
      },
      {
        groupId: "payment",
        label: "Payment",
        count: 7,
        trend7: 0,
        severity: "medium",
        revenueImpact: 220,
        lowEstimate: 120,
        highEstimate: 220,
        priorityScore: 63,
        actionType: "faq",
        suggestedAction: "Create payment FAQ",
      },
    ],
    faqOpportunities: [
      { groupId: "shipping", question: "How long does shipping take?", rationale: "Asked often", frequency: 12, hasContent: false, priority: 91 },
      { groupId: "payment", question: "Do you accept PayPal?", rationale: "Asked often", frequency: 7, hasContent: false, priority: 63 },
    ],
    contentGaps: [
      {
        productId: "gid://shopify/Product/1",
        productTitle: "Starter Kit",
        mentionCount: 2,
        contentGapScore: 70,
        missingSections: ["Shipping Timeline", "Warranty Page"],
        coveredSections: [],
        customerQuestions: ["When does it arrive?"],
        estimatedLow: 100,
        estimatedHigh: 240,
        recommendedActions: ["Generate Shipping Timeline"],
      },
    ],
    competitorThreats: [{ name: "Amazon", mentionCount: 2, threatScore: 60, reasons: ["Lower price"], recommendation: "Add comparison copy" }],
    ...overrides,
  };
}

describe("revenue automation", () => {
  it("builds one prioritized recovery plan with real action targets", () => {
    const plan = buildRecoveryPlan({
      insight: insight(),
      publishedCounts: { total: 0, pages: 0, blogs: 0, productFaqs: 0 },
    });

    expect(plan.revenueAtRisk).toBe(1781);
    expect(plan.topIssues[0]?.title).toBe("Shipping Questions");
    expect(plan.topIssues[0]?.estimatedImpact).toBe(523);
    expect(plan.topIssues[0]?.actions.map((action) => action.targetUrl)).toEqual([
      "/app/faq?group=shipping",
      "/app/recovery",
      "/app/widget",
    ]);
    expect(plan.completedActions).toBe(0);
    expect(plan.totalActions).toBe(6);
  });

  it("calculates potential score from answered questions and published assets", () => {
    const score = calculateRecoveryScoreImprovement({
      insight: insight(),
      publishedCounts: { total: 3, pages: 2, blogs: 1, productFaqs: 0 },
      generatedFaqs: [
        { groupId: "shipping", status: "draft" },
        { groupId: "payment", status: "published" },
      ],
    });

    expect(score.currentScore).toBe(31);
    expect(score.potentialScore).toBeGreaterThan(31);
    expect(score.factors.questionsAnswered).toBe(2);
    expect(score.factors.faqCoverage).toBe(100);
  });

  it("scans theme content for missing revenue recovery sections", () => {
    const issues = scanThemeContent({
      themeText: "Product page with reviews and secure checkout only",
      insight: insight(),
    });

    expect(issues.map((issue) => issue.id)).toContain("faq");
    expect(issues.map((issue) => issue.id)).toContain("shipping");
    expect(issues[0]?.recommendedFix).toMatch(/FAQ|shipping|return|warranty|guide/i);
  });

  it("does not invent revenue estimates when no opportunity exists", () => {
    const issues = scanThemeContent({
      themeText: "Product page with reviews and secure checkout only",
      insight: EMPTY_INSIGHT,
    });

    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.estimatedImpact).toBe(0);
    expect(issues[0]?.impact).toBe("Content coverage issue");
  });

  it("defines reusable content packs with FAQ schema and publish targets", () => {
    const shippingPack = CONTENT_PACKS.find((pack) => pack.id === "shipping");

    expect(shippingPack?.faqs.length).toBeGreaterThan(0);
    expect(shippingPack?.schemaType).toBe("FAQPage");
    expect(shippingPack?.suggestedPublishTargets).toContain("FAQ widget");
  });

  it("builds timeline v2 cards without order-level attribution", () => {
    const plan = buildRecoveryPlan({
      insight: insight(),
      publishedCounts: { total: 2, pages: 1, blogs: 1, productFaqs: 0 },
    });
    const cards = buildRevenueTimelineV2({
      generatedFaqs: [{ groupId: "shipping", status: "draft" }],
      publishedCounts: { total: 2, pages: 1, blogs: 1, productFaqs: 0 },
      plan,
    });

    expect(cards.map((card) => card.type)).toEqual([
      "content_created",
      "content_published",
      "pages_published",
      "products_fixed",
      "revenue_recovered",
    ]);
    expect(cards.find((card) => card.type === "revenue_recovered")?.highEstimate).toBe(plan.expectedRecoveryHigh);
  });
});
