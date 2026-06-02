// Tests for reviewer/demo mode — verifies that isReviewerMode detects empty
// stores correctly and that buildSampleInsight returns a well-formed InsightResult.

import { describe, expect, it, vi } from "vitest";
import { isReviewerMode, buildSampleInsight } from "~/lib/reviewer-mode.server";
import type { PrismaClient } from "@prisma/client";

function makeDb(msgCount: number, runCount: number): PrismaClient {
  return {
    importedMessage: { count: vi.fn().mockResolvedValue(msgCount) },
    insightRun: { count: vi.fn().mockResolvedValue(runCount) },
  } as unknown as PrismaClient;
}

function makeFailingDb(): PrismaClient {
  return {
    importedMessage: { count: vi.fn().mockRejectedValue(new Error("DB error")) },
    insightRun: { count: vi.fn().mockRejectedValue(new Error("DB error")) },
  } as unknown as PrismaClient;
}

// --- isReviewerMode ---

describe("isReviewerMode", () => {
  it("returns true when both counts are 0", async () => {
    expect(await isReviewerMode(makeDb(0, 0), "shop1")).toBe(true);
  });

  it("returns false when importedMessage count > 0", async () => {
    expect(await isReviewerMode(makeDb(5, 0), "shop1")).toBe(false);
  });

  it("returns false when insightRun count > 0", async () => {
    expect(await isReviewerMode(makeDb(0, 1), "shop1")).toBe(false);
  });

  it("returns false when both counts > 0", async () => {
    expect(await isReviewerMode(makeDb(10, 3), "shop1")).toBe(false);
  });

  it("returns false (safe) when DB throws", async () => {
    expect(await isReviewerMode(makeFailingDb(), "shop1")).toBe(false);
  });
});

// --- buildSampleInsight ---

describe("buildSampleInsight", () => {
  it("returns an object with insightScore > 0", () => {
    const s = buildSampleInsight();
    expect(s.insightScore).toBeGreaterThan(0);
  });

  it("has at least 3 questionOpportunities", () => {
    expect(buildSampleInsight().questionOpportunities.length).toBeGreaterThanOrEqual(3);
  });

  it("has at least 2 storewideOpportunities", () => {
    expect(buildSampleInsight().storewideOpportunities.length).toBeGreaterThanOrEqual(2);
  });

  it("has at least 2 productConfusion entries", () => {
    expect(buildSampleInsight().productConfusion.length).toBeGreaterThanOrEqual(2);
  });

  it("has at least 2 contentGaps", () => {
    expect(buildSampleInsight().contentGaps.length).toBeGreaterThanOrEqual(2);
  });

  it("weeklyTrend has 7 data points", () => {
    expect(buildSampleInsight().weeklyTrend).toHaveLength(7);
  });

  it("revenue estimatedHigh > 0", () => {
    expect(buildSampleInsight().revenueOpportunity.estimatedHigh).toBeGreaterThan(0);
  });

  it("weeklyTrend dates are in ISO format (yyyy-mm-dd)", () => {
    buildSampleInsight().weeklyTrend.forEach((pt) => {
      expect(pt.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it("accepts a custom 'now' date for deterministic output", () => {
    const now = new Date("2025-01-15T00:00:00Z");
    const s = buildSampleInsight(now);
    expect(s.generatedAt).toContain("2025-01-15");
  });

  it("all questionOpportunities have valid severity", () => {
    buildSampleInsight().questionOpportunities.forEach((o) => {
      expect(["low", "medium", "high"]).toContain(o.severity);
    });
  });
});
