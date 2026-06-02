// Performance benchmark: report engine (revenue timeline + marketing asset generation).
// Target: 500 events aggregated < 100ms; 50 asset batches < 200ms.

import { describe, expect, it } from "vitest";
import {
  buildRevenueTimelineSummary,
  buildTimelinePoints,
  aggregateByEventType,
  filterEventsByDateRange,
  type RawRevenueEvent,
  type RevenueEventType,
} from "~/lib/revenue-timeline";
import { generateAssetBatch, type MarketingAssetType } from "~/lib/marketing-assets";
import { EMPTY_INSIGHT } from "~/lib/types";

const EVENT_TYPES: RevenueEventType[] = [
  "content_published",
  "faq_created",
  "insight_run",
  "competitor_resolved",
  "bulk_job",
  "manual",
];

function makeRevenueEvents(count: number): RawRevenueEvent[] {
  const base = new Date("2026-01-01T00:00:00Z").getTime();
  return Array.from({ length: count }, (_, i) => ({
    id: `evt-${i}`,
    eventType: EVENT_TYPES[i % EVENT_TYPES.length],
    description: `Revenue event ${i}: content published for shipping FAQ`,
    refId: `ref-${i}`,
    refType: "published_content",
    lowEstimate: 50 + (i % 10) * 10,
    highEstimate: 150 + (i % 10) * 20,
    actualValue: i % 5 === 0 ? 100 : null,
    occurredAt: new Date(base + i * 86_400_000),
  }));
}

describe("Report Engine — performance benchmarks", () => {
  it("buildRevenueTimelineSummary: 100 events < 50ms", () => {
    const events = makeRevenueEvents(100);
    const start = performance.now();
    const summary = buildRevenueTimelineSummary(events);
    const elapsed = performance.now() - start;
    expect(summary.eventCount).toBe(100);
    expect(elapsed).toBeLessThan(50);
  });

  it("buildRevenueTimelineSummary: 500 events < 200ms", () => {
    const events = makeRevenueEvents(500);
    const start = performance.now();
    const summary = buildRevenueTimelineSummary(events);
    const elapsed = performance.now() - start;
    expect(summary.eventCount).toBe(500);
    expect(elapsed).toBeLessThan(200);
  });

  it("buildTimelinePoints: 500 events < 100ms", () => {
    const events = makeRevenueEvents(500);
    const start = performance.now();
    const points = buildTimelinePoints(events);
    const elapsed = performance.now() - start;
    expect(points.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(100);
  });

  it("aggregateByEventType: 500 events < 20ms", () => {
    const events = makeRevenueEvents(500);
    const start = performance.now();
    const breakdown = aggregateByEventType(events);
    const elapsed = performance.now() - start;
    expect(breakdown.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(20);
  });

  it("generateAssetBatch: 10 batch runs < 100ms", () => {
    const input = {
      platform: "instagram" as const,
      tone: "professional" as const,
      storeName: "TestStore",
      insight: EMPTY_INSIGHT,
    };
    const allTypes: MarketingAssetType[] = ["social_post", "email_subject", "ad_copy", "review_request", "sms_snippet"];
    const start = performance.now();
    for (let i = 0; i < 10; i++) {
      generateAssetBatch(input, allTypes);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});
