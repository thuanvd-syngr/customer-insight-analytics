import { describe, expect, it } from "vitest";
import {
  aggregateUsageByFeature,
  buildConversionFunnel,
  FEATURE_LABELS,
  parseMetadata,
  serializeMetadata,
  topFeatures,
  usageDayCount,
  type FeatureId,
  type UsageEventRecord,
} from "~/lib/usage-analytics";

let _seq = 0;
function makeEvent(featureId: FeatureId, occurredAt = "2026-06-01T00:00:00Z"): UsageEventRecord {
  return { id: `evt-${++_seq}`, shopId: "shop-1", featureId, metadata: null, occurredAt };
}

describe("aggregateUsageByFeature", () => {
  it("counts occurrences per feature", () => {
    const events = [
      makeEvent("insight_run"),
      makeEvent("insight_run"),
      makeEvent("faq_generated"),
    ];
    const summary = aggregateUsageByFeature(events);
    const insightEntry = summary.find((s) => s.featureId === "insight_run");
    expect(insightEntry?.count).toBe(2);
    expect(summary.find((s) => s.featureId === "faq_generated")?.count).toBe(1);
  });

  it("sorts by count descending", () => {
    const events = [
      makeEvent("faq_generated"),
      makeEvent("insight_run"),
      makeEvent("insight_run"),
      makeEvent("insight_run"),
    ];
    const summary = aggregateUsageByFeature(events);
    expect(summary[0].featureId).toBe("insight_run");
  });

  it("returns empty array for no events", () => {
    expect(aggregateUsageByFeature([])).toEqual([]);
  });

  it("includes label from FEATURE_LABELS", () => {
    const [entry] = aggregateUsageByFeature([makeEvent("copilot_used")]);
    expect(entry.label).toBe(FEATURE_LABELS.copilot_used);
  });
});

describe("buildConversionFunnel", () => {
  it("installed is always reached", () => {
    const funnel = buildConversionFunnel([]);
    const installed = funnel.stages.find((s) => s.stage === "installed");
    expect(installed?.reached).toBe(true);
  });

  it("analyzed stage reached after insight_run event", () => {
    const funnel = buildConversionFunnel([makeEvent("insight_run")]);
    const analyzed = funnel.stages.find((s) => s.stage === "analyzed");
    expect(analyzed?.reached).toBe(true);
  });

  it("content_published stage reached after content_published event", () => {
    const funnel = buildConversionFunnel([makeEvent("content_published")]);
    const stage = funnel.stages.find((s) => s.stage === "content_published");
    expect(stage?.reached).toBe(true);
  });

  it("revenue_tracked stage reached after roi_viewed", () => {
    const funnel = buildConversionFunnel([makeEvent("roi_viewed")]);
    const stage = funnel.stages.find((s) => s.stage === "revenue_tracked");
    expect(stage?.reached).toBe(true);
  });

  it("farthestStage advances correctly", () => {
    const funnel = buildConversionFunnel([
      makeEvent("insight_run"),
      makeEvent("content_published"),
    ]);
    expect(funnel.farthestStage).toBe("content_published");
  });

  it("dropoffStage is null when all stages reached", () => {
    const funnel = buildConversionFunnel([
      makeEvent("insight_run"),
      makeEvent("content_published"),
      makeEvent("roi_viewed"),
    ]);
    expect(funnel.dropoffStage).toBeNull();
  });

  it("dropoffStage identifies first un-reached stage", () => {
    const funnel = buildConversionFunnel([]); // nothing after install
    expect(funnel.dropoffStage).toBe("analyzed");
  });

  it("completionRate is 20 for install-only", () => {
    const funnel = buildConversionFunnel([]);
    expect(funnel.completionRate).toBe(20); // 1/5 = 20%
  });

  it("completionRate is 100 for all stages", () => {
    const funnel = buildConversionFunnel([
      makeEvent("insight_run"),
      makeEvent("content_published"),
      makeEvent("roi_viewed"),
    ]);
    expect(funnel.completionRate).toBe(100);
  });

  it("stages are ordered 1-5", () => {
    const funnel = buildConversionFunnel([]);
    const orders = funnel.stages.map((s) => s.order);
    expect(orders).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("topFeatures", () => {
  it("returns top N by count", () => {
    const events = [
      makeEvent("insight_run"),
      makeEvent("insight_run"),
      makeEvent("insight_run"),
      makeEvent("faq_generated"),
      makeEvent("faq_generated"),
      makeEvent("copilot_used"),
    ];
    const top2 = topFeatures(events, 2);
    expect(top2).toHaveLength(2);
    expect(top2[0].featureId).toBe("insight_run");
    expect(top2[1].featureId).toBe("faq_generated");
  });

  it("defaults to 5 results", () => {
    const events = Array.from({ length: 20 }, (_, i) =>
      makeEvent(["insight_run", "faq_generated", "copilot_used", "roi_viewed", "library_viewed", "marketing_generated"][i % 6] as FeatureId)
    );
    expect(topFeatures(events).length).toBeLessThanOrEqual(5);
  });
});

describe("serializeMetadata / parseMetadata", () => {
  it("serializes an object to JSON string", () => {
    const json = serializeMetadata({ plan: "growth", count: 5 });
    expect(json).not.toBeNull();
    expect(JSON.parse(json!)).toEqual({ plan: "growth", count: 5 });
  });

  it("returns null for empty object", () => {
    expect(serializeMetadata({})).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(serializeMetadata(undefined)).toBeNull();
  });

  it("parses a valid JSON string", () => {
    const result = parseMetadata('{"source":"copilot","words":3}');
    expect(result).toEqual({ source: "copilot", words: 3 });
  });

  it("returns null for invalid JSON", () => {
    expect(parseMetadata("not-json")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(parseMetadata(null)).toBeNull();
  });

  it("returns null for array JSON (not an object)", () => {
    expect(parseMetadata("[1,2,3]")).toBeNull();
  });
});

describe("usageDayCount", () => {
  it("counts distinct days", () => {
    const events: UsageEventRecord[] = [
      { id: "1", shopId: "s", featureId: "insight_run", metadata: null, occurredAt: "2026-06-01T00:00:00Z" },
      { id: "2", shopId: "s", featureId: "insight_run", metadata: null, occurredAt: "2026-06-01T12:00:00Z" },
      { id: "3", shopId: "s", featureId: "insight_run", metadata: null, occurredAt: "2026-06-02T00:00:00Z" },
    ];
    expect(usageDayCount(events, "insight_run")).toBe(2);
  });

  it("returns 0 for non-matching feature", () => {
    const events: UsageEventRecord[] = [
      { id: "1", shopId: "s", featureId: "insight_run", metadata: null, occurredAt: "2026-06-01T00:00:00Z" },
    ];
    expect(usageDayCount(events, "faq_generated")).toBe(0);
  });
});

describe("FEATURE_LABELS", () => {
  it("covers all FeatureId values", () => {
    const expected: FeatureId[] = [
      "insight_run", "faq_generated", "content_published", "bulk_job_started",
      "copilot_used", "marketing_generated", "competitor_viewed", "roi_viewed",
      "library_viewed", "onboarding_completed", "billing_upgraded",
    ];
    for (const id of expected) {
      expect(FEATURE_LABELS[id]).toBeDefined();
      expect(FEATURE_LABELS[id].length).toBeGreaterThan(0);
    }
  });
});
