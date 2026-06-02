// Performance benchmark: competitor engine (V2 confidence loss + ranking).
// Target: 50 competitors scored and ranked in < 100ms.

import { describe, expect, it } from "vitest";
import {
  calculateCompetitorV2Summary,
  calculateConfidenceLossScore,
  rankCompetitorsByThreat,
  buildComparisonOpportunities,
} from "~/lib/competitor-v2";
import type { CompetitorMentionResult, CompetitorThreat } from "~/lib/types";

function makeCompetitor(i: number): CompetitorMentionResult {
  return {
    name: `Competitor-${i}`,
    count: (i % 20) + 1,
    exampleQuote: i % 2 === 0 ? `Customer ${i} said "switching to this competitor"` : undefined,
  };
}

function makeThreat(competitor: CompetitorMentionResult): CompetitorThreat {
  return {
    name: competitor.name,
    mentionCount: competitor.count,
    threatScore: Math.min(100, competitor.count * 5),
    reasons: ["price", "features", "trust"].slice(0, (competitor.count % 3) + 1),
    recommendation: `Address ${competitor.name} with comparison content.`,
    exampleQuote: competitor.exampleQuote,
  };
}

describe("Competitor Engine — performance benchmarks", () => {
  it("calculateConfidenceLossScore: 50 competitors < 20ms", () => {
    const competitors = Array.from({ length: 50 }, (_, i) => makeCompetitor(i));
    const threats = competitors.map(makeThreat);
    const start = performance.now();
    for (const comp of competitors) {
      const threat = threats.find((t) => t.name === comp.name);
      calculateConfidenceLossScore(comp, threat);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(20);
  });

  it("rankCompetitorsByThreat: 50 competitors < 10ms", () => {
    const competitors = Array.from({ length: 50 }, (_, i) => makeCompetitor(i));
    const threats = competitors.map(makeThreat);
    const start = performance.now();
    const ranked = rankCompetitorsByThreat(competitors, threats);
    const elapsed = performance.now() - start;
    expect(ranked.length).toBe(50);
    expect(elapsed).toBeLessThan(10);
  });

  it("calculateCompetitorV2Summary: 20 competitors < 30ms", () => {
    const competitors = Array.from({ length: 20 }, (_, i) => makeCompetitor(i));
    const scores = competitors.map((c) => calculateConfidenceLossScore(c));
    const start = performance.now();
    const summary = calculateCompetitorV2Summary(competitors, scores);
    const elapsed = performance.now() - start;
    expect(summary.totalMentions).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(30);
  });

  it("buildComparisonOpportunities: 10 competitors < 20ms", () => {
    const competitors = Array.from({ length: 10 }, (_, i) => makeCompetitor(i));
    const start = performance.now();
    for (const comp of competitors) {
      const score = calculateConfidenceLossScore(comp);
      buildComparisonOpportunities(comp, score);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(20);
  });

  it("100 scoring passes complete under 50ms", () => {
    const comp = makeCompetitor(5);
    const threat = makeThreat(comp);
    const start = performance.now();
    for (let i = 0; i < 100; i++) calculateConfidenceLossScore(comp, threat);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});
