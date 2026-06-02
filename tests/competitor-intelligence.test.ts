import { describe, expect, it } from "vitest";

import {
  buildAllCompetitorIntelligence,
  buildCompetitorIntelligence,
  classifyIntent,
  classifyMentions,
  INTENT_LABELS,
  type ClassifiedMention,
} from "~/lib/engine/competitor-intelligence";

describe("classifyIntent", () => {
  it("classifies switching signals", () => {
    expect(classifyIntent("I am switching to Burton")).toBe("switching");
    expect(classifyIntent("Going to try a different brand")).toBe("switching");
    expect(classifyIntent("I'm leaving for Nitro")).toBe("switching");
  });

  it("classifies price signals", () => {
    expect(classifyIntent("Burton is cheaper than this")).toBe("price");
    expect(classifyIntent("I found a better price elsewhere")).toBe("price");
    expect(classifyIntent("This is too expensive compared to Capita")).toBe("price");
  });

  it("classifies feature signals", () => {
    expect(classifyIntent("Is your board better quality than Nitro?")).toBe("feature");
    expect(classifyIntent("Which has more features?")).toBe("feature");
  });

  it("classifies trust signals", () => {
    expect(classifyIntent("I read bad reviews about this store")).toBe("trust");
    expect(classifyIntent("Not sure if you are reputable")).toBe("trust");
  });

  it("classifies comparison signals", () => {
    expect(classifyIntent("How does this compare vs Burton?")).toBe("comparison");
    expect(classifyIntent("Which one should I choose between these?")).toBe("comparison");
  });

  it("falls back to general for unrelated text", () => {
    expect(classifyIntent("Burton")).toBe("general");
    expect(classifyIntent("I saw this competitor mentioned")).toBe("general");
  });

  it("handles empty string", () => {
    expect(classifyIntent("")).toBe("general");
  });
});

describe("classifyMentions", () => {
  it("classifies an array of mentions", () => {
    const raw = [
      { name: "Burton", quote: "switching to Burton next season" },
      { name: "Nitro", quote: "Nitro is cheaper" },
      { name: "Capita", quote: "Capita" },
    ];
    const result = classifyMentions(raw);
    expect(result).toHaveLength(3);
    expect(result[0]?.intentType).toBe("switching");
    expect(result[1]?.intentType).toBe("price");
    expect(result[2]?.intentType).toBe("general");
  });
});

describe("buildCompetitorIntelligence", () => {
  const baseMentions: ClassifiedMention[] = [
    { competitorName: "Burton", quote: "switching to Burton", intentType: "switching", occurredAt: new Date() },
    { competitorName: "Burton", quote: "Burton is cheaper", intentType: "price", occurredAt: new Date() },
    { competitorName: "Burton", quote: "comparing Burton vs this", intentType: "comparison", occurredAt: new Date() },
  ];

  it("returns all required fields", () => {
    const result = buildCompetitorIntelligence("Burton", baseMentions);
    expect(result.name).toBe("Burton");
    expect(result.totalMentions).toBe(3);
    expect(result.switchingRisk).toBeGreaterThanOrEqual(0);
    expect(result.switchingRisk).toBeLessThanOrEqual(100);
    expect(result.priceRisk).toBeGreaterThanOrEqual(0);
    expect(result.revenueAtRisk).toBeGreaterThan(0);
    expect(result.opportunities.length).toBeGreaterThan(0);
  });

  it("calculates higher switching risk when switching intent dominates", () => {
    const switchingMentions: ClassifiedMention[] = Array.from({ length: 5 }, () => ({
      competitorName: "Burton",
      quote: "I'm switching to Burton",
      intentType: "switching" as const,
      occurredAt: new Date(),
    }));
    const result = buildCompetitorIntelligence("Burton", switchingMentions);
    expect(result.switchingRisk).toBeGreaterThan(40);
  });

  it("returns zero scores for empty mention list", () => {
    const result = buildCompetitorIntelligence("Burton", []);
    expect(result.totalMentions).toBe(0);
    expect(result.switchingRisk).toBe(0);
    expect(result.priceRisk).toBe(0);
    expect(result.revenueAtRisk).toBe(0);
  });

  it("includes topQuote when mentions have quotes", () => {
    const result = buildCompetitorIntelligence("Burton", baseMentions);
    expect(result.topQuote).toBeTruthy();
  });

  it("calculates growth rate vs prior period", () => {
    const result = buildCompetitorIntelligence("Burton", baseMentions, 1);
    // 3 current vs 1 prior = +200%
    expect(result.growthRate).toBe(200);
  });

  it("generates comparison_content opportunity when comparison intent exists", () => {
    const result = buildCompetitorIntelligence("Burton", baseMentions);
    const opps = result.opportunities.map((o) => o.type);
    expect(opps).toContain("comparison_content");
  });

  it("generates price_objection opportunity when price intent is high", () => {
    const priceMentions: ClassifiedMention[] = Array.from({ length: 3 }, () => ({
      competitorName: "Burton",
      quote: "Burton is cheaper",
      intentType: "price" as const,
      occurredAt: new Date(),
    }));
    const result = buildCompetitorIntelligence("Burton", priceMentions);
    expect(result.opportunities.some((o) => o.type === "price_objection")).toBe(true);
  });
});

describe("buildAllCompetitorIntelligence", () => {
  it("returns sorted by revenue at risk descending", () => {
    const competitors = [
      { name: "Burton", count: 1, exampleQuote: null },
      { name: "Nitro", count: 5, exampleQuote: "switching to Nitro" },
    ];
    const result = buildAllCompetitorIntelligence(competitors);
    expect(result[0]?.name).toBe("Nitro");
  });

  it("filters out competitors with zero mentions", () => {
    const competitors = [
      { name: "Zero", count: 0, exampleQuote: null },
      { name: "One", count: 1, exampleQuote: null },
    ];
    const result = buildAllCompetitorIntelligence(competitors);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("One");
  });

  it("returns empty array for empty input", () => {
    expect(buildAllCompetitorIntelligence([])).toHaveLength(0);
  });
});

describe("INTENT_LABELS", () => {
  it("has a label for every intent type", () => {
    const intents = ["comparison", "switching", "price", "feature", "trust", "general"];
    for (const intent of intents) {
      expect(INTENT_LABELS[intent as keyof typeof INTENT_LABELS]).toBeTruthy();
    }
  });
});
