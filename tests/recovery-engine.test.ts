import { describe, expect, it } from "vitest";

import { buildCompetitorThreats, buildContentGapAnalysis } from "~/lib/recovery-engine.server";

describe("recovery engine", () => {
  it("detects product content gaps from customer questions", () => {
    const [gap] = buildContentGapAnalysis({
      products: [{
        productId: "gid://shopify/Product/1",
        productTitle: "CloudFit Hoodie",
        mentionCount: 11,
        confusionScore: 82,
        topGroups: ["size", "return", "shipping"],
      }],
      faqOpportunities: [{
        groupId: "size",
        question: "What size should I buy?",
        rationale: "Customers ask before buying",
        frequency: 11,
        hasContent: false,
        priority: 90,
      }],
      questionOpportunities: [{
        groupId: "size",
        label: "Size",
        count: 11,
        trend7: 0.4,
        severity: "high",
        revenueImpact: 220,
        lowEstimate: 90,
        highEstimate: 250,
        priorityScore: 88,
        actionType: "content_block",
        suggestedAction: "Improve Size Guide",
      }],
    });

    expect(gap?.contentGapScore).toBeGreaterThan(50);
    expect(gap?.missingSections).toContain("Size Guide");
    expect(gap?.estimatedHigh).toBe(250);
  });

  it("scores competitor threats and recommends a response", () => {
    const [threat] = buildCompetitorThreats([
      {
        name: "Temu",
        count: 4,
        exampleQuote: "Is this cheaper on Temu?",
      },
    ], 2);

    expect(threat?.threatScore).toBeGreaterThan(0);
    expect(threat?.reasons).toContain("Lower price");
    expect(threat?.recommendation).toContain("quality");
  });
});
