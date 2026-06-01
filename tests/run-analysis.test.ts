import { describe, expect, it } from "vitest";

import { runAnalysis } from "~/lib/engine";
import { buildSampleAnalysisInput } from "~/lib/sample-data";

describe("runAnalysis", () => {
  it("returns populated sample insight", () => {
    const result = runAnalysis(buildSampleAnalysisInput(new Date("2026-06-01T00:00:00Z")));
    expect(result.messageCount).toBeGreaterThan(0);
    expect(result.insightScore).toBeGreaterThanOrEqual(0);
    expect(result.insightScore).toBeLessThanOrEqual(100);
    expect(result.keywordGroups.length).toBeGreaterThan(0);
    expect(result.weeklyTrend).toHaveLength(7);
  });
});
