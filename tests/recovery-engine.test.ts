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

  it("handles empty catalogs gracefully", () => {
    expect(buildContentGapAnalysis({
      storeProducts: [],
      products: [],
      faqOpportunities: [],
      questionOpportunities: [],
    })).toEqual([]);
  });

  it("storewide-only question opportunities do not create per-product content gaps", () => {
    // Shipping is a storewide topic — gap-only products with no direct confusion
    // should NOT get a shipping content gap.
    const genericProducts = Array.from({ length: 10 }, (_, index) => ({
      id: `gid://shopify/Product/${index}`,
      title: `Product ${index}`,
      description: "Generic product without ingredient/size/usage signals",
    }));

    const gaps = buildContentGapAnalysis({
      storeProducts: genericProducts,
      products: [],
      faqOpportunities: [],
      questionOpportunities: [{
        groupId: "shipping",
        label: "Shipping",
        count: 12,
        trend7: 0.1,
        severity: "medium",
        revenueImpact: 180,
        lowEstimate: 80,
        highEstimate: 240,
        priorityScore: 64,
        actionType: "faq",
        suggestedAction: "Add Shipping FAQ",
      }],
    });

    // Storewide "shipping" must NOT appear in product content gaps
    expect(gaps).toHaveLength(0);
  });

  it("direct-confusion products keep all groups including storewide topics", () => {
    // When a customer explicitly mentions a product, ALL their friction topics
    // (including storewide ones like return/shipping) are valid for that product.
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
    // Direct confusion products carry their real mentionCount
    expect(gap?.mentionCount).toBe(11);
  });
});
