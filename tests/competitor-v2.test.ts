import { describe, expect, it } from "vitest";

import {
  calculateConfidenceLossScore,
  buildComparisonOpportunities,
  calculateCompetitorV2Summary,
  rankCompetitorsByThreat,
  getConfidenceLossLevel,
  COMPARISON_OPPORTUNITY_LABELS,
  type ConfidenceLossLevel,
} from "~/lib/competitor-v2";
import type { CompetitorMentionResult, CompetitorThreat } from "~/lib/types";

const MOCK_COMPETITORS: CompetitorMentionResult[] = [
  { name: "RivalCo", count: 10, exampleQuote: "I might switch to RivalCo" },
  { name: "BestBrand", count: 5, exampleQuote: "BestBrand has better prices" },
  { name: "TopStore", count: 1, exampleQuote: undefined },
];

const MOCK_THREATS: CompetitorThreat[] = [
  {
    name: "RivalCo",
    mentionCount: 10,
    threatScore: 75,
    reasons: ["lower price", "faster shipping", "free returns"],
    recommendation: "Create comparison page",
    exampleQuote: "I might switch to RivalCo",
  },
  {
    name: "BestBrand",
    mentionCount: 5,
    threatScore: 40,
    reasons: ["better UX"],
    recommendation: "Improve checkout",
    exampleQuote: "BestBrand has better prices",
  },
];

// ─── getConfidenceLossLevel ───────────────────────────────────────────────────

describe("getConfidenceLossLevel", () => {
  it("returns 'none' for score <= 10", () => {
    expect(getConfidenceLossLevel(0)).toBe("none");
    expect(getConfidenceLossLevel(10)).toBe("none");
  });

  it("returns 'low' for score 11-30", () => {
    expect(getConfidenceLossLevel(20)).toBe("low");
    expect(getConfidenceLossLevel(30)).toBe("low");
  });

  it("returns 'moderate' for score 31-55", () => {
    expect(getConfidenceLossLevel(45)).toBe("moderate");
    expect(getConfidenceLossLevel(55)).toBe("moderate");
  });

  it("returns 'high' for score 56-75", () => {
    expect(getConfidenceLossLevel(65)).toBe("high");
    expect(getConfidenceLossLevel(75)).toBe("high");
  });

  it("returns 'critical' for score > 75", () => {
    expect(getConfidenceLossLevel(80)).toBe("critical");
    expect(getConfidenceLossLevel(100)).toBe("critical");
  });
});

// ─── calculateConfidenceLossScore ────────────────────────────────────────────

describe("calculateConfidenceLossScore", () => {
  it("returns a score with competitorName", () => {
    const result = calculateConfidenceLossScore(MOCK_COMPETITORS[0], MOCK_THREATS[0]);
    expect(result.competitorName).toBe("RivalCo");
  });

  it("totalScore is between 0 and 100", () => {
    const result = calculateConfidenceLossScore(MOCK_COMPETITORS[0], MOCK_THREATS[0]);
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
    expect(result.totalScore).toBeLessThanOrEqual(100);
  });

  it("has 4 factors", () => {
    const result = calculateConfidenceLossScore(MOCK_COMPETITORS[0], MOCK_THREATS[0]);
    expect(result.factors).toHaveLength(4);
  });

  it("higher mention count → higher score", () => {
    const high = calculateConfidenceLossScore(MOCK_COMPETITORS[0]); // 10 mentions
    const low = calculateConfidenceLossScore(MOCK_COMPETITORS[2]); // 1 mention
    expect(high.totalScore).toBeGreaterThan(low.totalScore);
  });

  it("switching quote increases score", () => {
    const withSwitch = calculateConfidenceLossScore({
      name: "X", count: 2, exampleQuote: "I'm switching to X for sure",
    });
    const withoutSwitch = calculateConfidenceLossScore({
      name: "Y", count: 2, exampleQuote: "Y seems okay",
    });
    expect(withSwitch.totalScore).toBeGreaterThan(withoutSwitch.totalScore);
  });

  it("includes recommendation string", () => {
    const result = calculateConfidenceLossScore(MOCK_COMPETITORS[0], MOCK_THREATS[0]);
    expect(result.recommendation).toBeTruthy();
  });

  it("works without threat argument", () => {
    const result = calculateConfidenceLossScore(MOCK_COMPETITORS[1]);
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
  });

  it("threat with more reasons → higher score", () => {
    const fewReasons = calculateConfidenceLossScore(MOCK_COMPETITORS[1], MOCK_THREATS[1]); // 1 reason
    const manyReasons = calculateConfidenceLossScore(MOCK_COMPETITORS[0], MOCK_THREATS[0]); // 3 reasons
    // manyReasons competitor also has more mentions, so just verify it's non-negative
    expect(manyReasons.factors.find((f) => f.label === "Threat reasons breadth")!.score).toBeGreaterThan(
      fewReasons.factors.find((f) => f.label === "Threat reasons breadth")!.score,
    );
  });
});

// ─── buildComparisonOpportunities ────────────────────────────────────────────

describe("buildComparisonOpportunities", () => {
  it("always includes a comparison_page opportunity", () => {
    const score = calculateConfidenceLossScore(MOCK_COMPETITORS[0], MOCK_THREATS[0]);
    const opps = buildComparisonOpportunities(MOCK_COMPETITORS[0], score);
    expect(opps.some((o) => o.opportunityType === "comparison_page")).toBe(true);
  });

  it("includes why_us_page for moderate+ threats", () => {
    const score = calculateConfidenceLossScore(MOCK_COMPETITORS[0], MOCK_THREATS[0]);
    const opps = buildComparisonOpportunities(MOCK_COMPETITORS[0], score);
    // RivalCo has high/critical level → should include why_us_page
    expect(opps.some((o) => o.opportunityType === "why_us_page")).toBe(true);
  });

  it("includes price_objection_faq for mentions >= 3", () => {
    const score = calculateConfidenceLossScore(MOCK_COMPETITORS[0], MOCK_THREATS[0]);
    const opps = buildComparisonOpportunities(MOCK_COMPETITORS[0], score);
    expect(opps.some((o) => o.opportunityType === "price_objection_faq")).toBe(true);
  });

  it("revenue estimates are positive", () => {
    const score = calculateConfidenceLossScore(MOCK_COMPETITORS[0], MOCK_THREATS[0]);
    const opps = buildComparisonOpportunities(MOCK_COMPETITORS[0], score);
    for (const opp of opps) {
      expect(opp.estimatedRevenueLow).toBeGreaterThanOrEqual(0);
      expect(opp.estimatedRevenueHigh).toBeGreaterThan(opp.estimatedRevenueLow);
    }
  });

  it("each opportunity has a title and description", () => {
    const score = calculateConfidenceLossScore(MOCK_COMPETITORS[0], MOCK_THREATS[0]);
    const opps = buildComparisonOpportunities(MOCK_COMPETITORS[0], score);
    for (const opp of opps) {
      expect(opp.title).toBeTruthy();
      expect(opp.description).toBeTruthy();
    }
  });

  it("competitor name is in opportunity title", () => {
    const score = calculateConfidenceLossScore(MOCK_COMPETITORS[0]);
    const opps = buildComparisonOpportunities(MOCK_COMPETITORS[0], score);
    const compPage = opps.find((o) => o.opportunityType === "comparison_page");
    expect(compPage?.title).toContain("RivalCo");
  });
});

// ─── calculateCompetitorV2Summary ────────────────────────────────────────────

describe("calculateCompetitorV2Summary", () => {
  it("counts total competitors", () => {
    const scores = MOCK_COMPETITORS.map((c) => calculateConfidenceLossScore(c, MOCK_THREATS.find((t) => t.name === c.name)));
    const summary = calculateCompetitorV2Summary(MOCK_COMPETITORS, scores);
    expect(summary.totalCompetitors).toBe(3);
  });

  it("sums total mentions", () => {
    const scores = MOCK_COMPETITORS.map((c) => calculateConfidenceLossScore(c));
    const summary = calculateCompetitorV2Summary(MOCK_COMPETITORS, scores);
    expect(summary.totalMentions).toBe(10 + 5 + 1);
  });

  it("identifies top competitor by mentions", () => {
    const scores = MOCK_COMPETITORS.map((c) => calculateConfidenceLossScore(c));
    const summary = calculateCompetitorV2Summary(MOCK_COMPETITORS, scores);
    expect(summary.topCompetitorName).toBe("RivalCo");
  });

  it("returns zeros for empty arrays", () => {
    const summary = calculateCompetitorV2Summary([], []);
    expect(summary.totalCompetitors).toBe(0);
    expect(summary.totalMentions).toBe(0);
    expect(summary.avgConfidenceLoss).toBe(0);
    expect(summary.topCompetitorName).toBeNull();
  });
});

// ─── rankCompetitorsByThreat ─────────────────────────────────────────────────

describe("rankCompetitorsByThreat", () => {
  it("returns one entry per competitor", () => {
    const ranked = rankCompetitorsByThreat(MOCK_COMPETITORS, MOCK_THREATS);
    expect(ranked).toHaveLength(MOCK_COMPETITORS.length);
  });

  it("sorts highest threat first", () => {
    const ranked = rankCompetitorsByThreat(MOCK_COMPETITORS, MOCK_THREATS);
    expect(ranked[0].confidenceLoss.totalScore).toBeGreaterThanOrEqual(
      ranked[ranked.length - 1].confidenceLoss.totalScore,
    );
  });

  it("each entry has competitor and confidenceLoss", () => {
    const ranked = rankCompetitorsByThreat(MOCK_COMPETITORS, MOCK_THREATS);
    for (const r of ranked) {
      expect(r.competitor).toBeTruthy();
      expect(r.confidenceLoss).toBeTruthy();
    }
  });
});

// ─── COMPARISON_OPPORTUNITY_LABELS ───────────────────────────────────────────

describe("COMPARISON_OPPORTUNITY_LABELS", () => {
  it("has a label for every opportunity type", () => {
    const types = [
      "comparison_page", "why_us_page", "price_objection_faq",
      "feature_comparison", "trust_content", "competitor_landing",
    ] as const;
    for (const t of types) {
      expect(COMPARISON_OPPORTUNITY_LABELS[t]).toBeTruthy();
    }
  });
});
