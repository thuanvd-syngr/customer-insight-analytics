import { describe, expect, it } from "vitest";

import { buildDashboardViewModel } from "~/lib/dashboard.server";
import { runAnalysis } from "~/lib/engine";
import { buildSampleAnalysisInput } from "~/lib/sample-data";

describe("dashboard loader view model", () => {
  it("returns safe empty state for a fresh install", () => {
    const model = buildDashboardViewModel({
      insight: null,
      importedMessages: 0,
      hasRun: false,
    });

    expect(model.isEmpty).toBe(true);
    expect(model.revenueOpportunity.headline).toBe("Add customer questions to reveal recovery actions");
    expect(model.revenueOpportunity.quickWins).toEqual([]);
    expect(model.revenueOpportunity.opportunities).toEqual([]);
    expect(model.revenueOpportunity.alerts).toEqual([]);
    expect(model.showQuickWins).toBe(false);
  });

  it("requires analysis when messages exist but no run has been saved", () => {
    const model = buildDashboardViewModel({
      insight: null,
      importedMessages: 36,
      hasRun: false,
    });

    expect(model.isEmpty).toBe(false);
    expect(model.needsAnalysis).toBe(true);
    expect(model.showRevenueOpportunity).toBe(false);
    expect(model.showQuickWins).toBe(false);
  });

  it("returns stable sample-data dashboard shape", () => {
    const insight = runAnalysis(buildSampleAnalysisInput(new Date("2026-06-01T00:00:00Z")));
    const model = buildDashboardViewModel({
      insight,
      importedMessages: insight.messageCount,
      hasRun: true,
    });

    expect(model.isEmpty).toBe(false);
    expect(model.needsAnalysis).toBe(false);
    expect(model.revenueOpportunity.headline).toContain("/mo estimated opportunity");
    expect(model.recommendedActions.length).toBeGreaterThan(0);
    expect(model.quickWins.length).toBeGreaterThan(0);
    expect(model.showQuickWins).toBe(true);
  });

  it("treats completed runs with no findings as not actionable", () => {
    const model = buildDashboardViewModel({
      insight: {
        insightScore: 100,
        messageCount: 1,
        keywordGroups: [],
        productConfusion: [],
        faqOpportunities: [],
        competitors: [],
        revenueLeakage: [],
        questionOpportunities: [],
        storewideOpportunities: [],
        recommendedActions: [],
        contentGaps: [],
        weeklyTrend: [],
      },
      importedMessages: 1,
      hasRun: true,
    });

    expect(model.noFindings).toBe(true);
    expect(model.hasActionableInsight).toBe(false);
    expect(model.showRevenueOpportunity).toBe(false);
    expect(model.showQuickWins).toBe(false);
  });

  it("does not require revenueOpportunity on legacy runs", () => {
    const model = buildDashboardViewModel({
      insight: {
        insightScore: 72,
        messageCount: 10,
        keywordGroups: [],
        productConfusion: [],
        faqOpportunities: [],
        competitors: [],
        revenueLeakage: [],
        weeklyTrend: [],
      },
      importedMessages: 10,
      hasRun: true,
    });

    expect(model.revenueOpportunity.headline).toBe("Add customer questions to reveal recovery actions");
    expect(model.quickWins).toEqual([]);
    expect(model.showQuickWins).toBe(false);
  });
});
