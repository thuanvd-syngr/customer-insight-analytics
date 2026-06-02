import { describe, expect, it } from "vitest";

import {
  buildTimelinePoints,
  detectMilestones,
  buildRevenueTimelineSummary,
  filterEventsByType,
  filterEventsByDateRange,
  aggregateByEventType,
  toDateString,
  EVENT_TYPE_LABELS,
  EVENT_TYPE_ICONS,
  type RawRevenueEvent,
  type RevenueEventType,
} from "~/lib/revenue-timeline";

const d = (dateStr: string) => new Date(dateStr);

const SAMPLE_EVENTS: RawRevenueEvent[] = [
  {
    id: "1",
    eventType: "content_published",
    description: "Published shipping FAQ",
    lowEstimate: 100,
    highEstimate: 250,
    actualValue: 120,
    occurredAt: d("2026-05-01T10:00:00Z"),
  },
  {
    id: "2",
    eventType: "faq_created",
    description: "Created return FAQ",
    lowEstimate: 80,
    highEstimate: 200,
    actualValue: null,
    occurredAt: d("2026-05-05T10:00:00Z"),
  },
  {
    id: "3",
    eventType: "content_published",
    description: "Published warranty page",
    lowEstimate: 60,
    highEstimate: 150,
    actualValue: null,
    occurredAt: d("2026-05-10T10:00:00Z"),
  },
  {
    id: "4",
    eventType: "bulk_job",
    description: "Bulk published 5 FAQs",
    lowEstimate: 200,
    highEstimate: 500,
    actualValue: null,
    occurredAt: d("2026-05-15T10:00:00Z"),
  },
  {
    id: "5",
    eventType: "competitor_resolved",
    description: "Created RivalCo comparison page",
    lowEstimate: 150,
    highEstimate: 400,
    actualValue: 180,
    occurredAt: d("2026-05-20T10:00:00Z"),
  },
  {
    id: "6",
    eventType: "manual",
    description: "Manually confirmed order recovery",
    lowEstimate: 75,
    highEstimate: 75,
    actualValue: 75,
    occurredAt: d("2026-06-01T10:00:00Z"),
  },
];

// ─── toDateString ─────────────────────────────────────────────────────────────

describe("toDateString", () => {
  it("returns YYYY-MM-DD from Date", () => {
    expect(toDateString(new Date("2026-05-15T10:00:00Z"))).toBe("2026-05-15");
  });

  it("returns YYYY-MM-DD from ISO string", () => {
    expect(toDateString("2026-05-15T10:00:00Z")).toBe("2026-05-15");
  });
});

// ─── buildTimelinePoints ─────────────────────────────────────────────────────

describe("buildTimelinePoints", () => {
  it("groups events by date", () => {
    const points = buildTimelinePoints(SAMPLE_EVENTS);
    // Each unique date becomes one point
    expect(points.length).toBeGreaterThan(0);
    expect(points.every((p) => p.date.length === 10)).toBe(true);
  });

  it("sums events within same day", () => {
    const sameDay: RawRevenueEvent[] = [
      { id: "a", eventType: "content_published", description: "A", lowEstimate: 100, highEstimate: 200, occurredAt: d("2026-05-01T08:00:00Z") },
      { id: "b", eventType: "faq_created", description: "B", lowEstimate: 50, highEstimate: 100, occurredAt: d("2026-05-01T15:00:00Z") },
    ];
    const points = buildTimelinePoints(sameDay);
    expect(points).toHaveLength(1);
    expect(points[0].eventCount).toBe(2);
  });

  it("returns points sorted by date ascending", () => {
    const points = buildTimelinePoints(SAMPLE_EVENTS);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].date >= points[i - 1].date).toBe(true);
    }
  });

  it("cumulativeLow is non-decreasing", () => {
    const points = buildTimelinePoints(SAMPLE_EVENTS);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].cumulativeLow).toBeGreaterThanOrEqual(points[i - 1].cumulativeLow);
    }
  });

  it("returns empty array for no events", () => {
    expect(buildTimelinePoints([])).toEqual([]);
  });
});

// ─── detectMilestones ────────────────────────────────────────────────────────

describe("detectMilestones", () => {
  it("detects $100 milestone", () => {
    const milestones = detectMilestones(SAMPLE_EVENTS);
    expect(milestones.some((m) => m.label === "$100 recovered")).toBe(true);
  });

  it("detects first content published milestone", () => {
    const milestones = detectMilestones(SAMPLE_EVENTS);
    expect(milestones.some((m) => m.label === "First content published")).toBe(true);
  });

  it("detects first FAQ created milestone", () => {
    const milestones = detectMilestones(SAMPLE_EVENTS);
    expect(milestones.some((m) => m.label === "First FAQ created")).toBe(true);
  });

  it("does not duplicate first content milestone", () => {
    const milestones = detectMilestones(SAMPLE_EVENTS);
    const firstContent = milestones.filter((m) => m.label === "First content published");
    expect(firstContent).toHaveLength(1);
  });

  it("returns empty array for no events", () => {
    expect(detectMilestones([])).toEqual([]);
  });
});

// ─── buildRevenueTimelineSummary ─────────────────────────────────────────────

describe("buildRevenueTimelineSummary", () => {
  it("calculates total low correctly", () => {
    const summary = buildRevenueTimelineSummary(SAMPLE_EVENTS);
    const expected = SAMPLE_EVENTS.reduce((s, e) => s + e.lowEstimate, 0);
    expect(summary.totalLow).toBe(expected);
  });

  it("calculates total high correctly", () => {
    const summary = buildRevenueTimelineSummary(SAMPLE_EVENTS);
    const expected = SAMPLE_EVENTS.reduce((s, e) => s + e.highEstimate, 0);
    expect(summary.totalHigh).toBe(expected);
  });

  it("sums actual values correctly", () => {
    const summary = buildRevenueTimelineSummary(SAMPLE_EVENTS);
    expect(summary.totalActual).toBe(120 + 180 + 75);
  });

  it("counts events correctly", () => {
    const summary = buildRevenueTimelineSummary(SAMPLE_EVENTS);
    expect(summary.eventCount).toBe(SAMPLE_EVENTS.length);
  });

  it("identifies top event type", () => {
    const summary = buildRevenueTimelineSummary(SAMPLE_EVENTS);
    // content_published appears twice, more than others
    expect(summary.topEventType).toBe("content_published");
  });

  it("returns zero summary for empty events", () => {
    const summary = buildRevenueTimelineSummary([]);
    expect(summary.totalLow).toBe(0);
    expect(summary.totalHigh).toBe(0);
    expect(summary.eventCount).toBe(0);
    expect(summary.topEventType).toBeNull();
  });
});

// ─── filterEventsByType ───────────────────────────────────────────────────────

describe("filterEventsByType", () => {
  it("returns only events of specified type", () => {
    const content = filterEventsByType(SAMPLE_EVENTS, "content_published");
    expect(content.every((e) => e.eventType === "content_published")).toBe(true);
    expect(content).toHaveLength(2);
  });

  it("returns empty array when no match", () => {
    const insight = filterEventsByType(SAMPLE_EVENTS, "insight_run");
    expect(insight).toHaveLength(0);
  });
});

// ─── filterEventsByDateRange ──────────────────────────────────────────────────

describe("filterEventsByDateRange", () => {
  it("filters events within range", () => {
    const result = filterEventsByDateRange(
      SAMPLE_EVENTS,
      d("2026-05-01"),
      d("2026-05-10"),
    );
    expect(result.length).toBeGreaterThan(0);
    for (const e of result) {
      const date = new Date(e.occurredAt);
      expect(date >= d("2026-05-01")).toBe(true);
      expect(date <= d("2026-05-10")).toBe(true);
    }
  });

  it("returns empty array when range misses all events", () => {
    const result = filterEventsByDateRange(SAMPLE_EVENTS, d("2020-01-01"), d("2020-12-31"));
    expect(result).toHaveLength(0);
  });
});

// ─── aggregateByEventType ─────────────────────────────────────────────────────

describe("aggregateByEventType", () => {
  it("aggregates by event type", () => {
    const agg = aggregateByEventType(SAMPLE_EVENTS);
    const contentRow = agg.find((r) => r.eventType === "content_published");
    expect(contentRow?.count).toBe(2);
  });

  it("sums lowEstimate correctly", () => {
    const agg = aggregateByEventType(SAMPLE_EVENTS);
    const contentRow = agg.find((r) => r.eventType === "content_published");
    expect(contentRow?.totalLow).toBe(100 + 60);
  });

  it("returns one row per unique event type", () => {
    const agg = aggregateByEventType(SAMPLE_EVENTS);
    const types = agg.map((r) => r.eventType);
    const uniqueTypes = new Set(types);
    expect(uniqueTypes.size).toBe(types.length);
  });
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe("EVENT_TYPE_LABELS", () => {
  it("has a label for every event type", () => {
    const types: RevenueEventType[] = [
      "content_published", "faq_created", "insight_run",
      "competitor_resolved", "bulk_job", "manual",
    ];
    for (const t of types) {
      expect(EVENT_TYPE_LABELS[t]).toBeTruthy();
    }
  });
});

describe("EVENT_TYPE_ICONS", () => {
  it("has an icon for every event type", () => {
    const types: RevenueEventType[] = [
      "content_published", "faq_created", "insight_run",
      "competitor_resolved", "bulk_job", "manual",
    ];
    for (const t of types) {
      expect(EVENT_TYPE_ICONS[t]).toBeTruthy();
    }
  });
});
