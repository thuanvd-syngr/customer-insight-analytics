// Revenue Timeline — pure functions for ROI tracking and timeline aggregation.
// DB access in route loaders via getDelegate(); these helpers are import-safe.

export type RevenueEventType =
  | "content_published"
  | "faq_created"
  | "insight_run"
  | "competitor_resolved"
  | "bulk_job"
  | "manual";

export interface RawRevenueEvent {
  id: string;
  eventType: RevenueEventType;
  description: string;
  refId?: string | null;
  refType?: string | null;
  lowEstimate: number;
  highEstimate: number;
  actualValue?: number | null;
  occurredAt: Date | string;
}

export interface TimelineEventSummary {
  type: RevenueEventType;
  description: string;
  low: number;
  high: number;
  actual?: number;
}

export interface TimelinePoint {
  date: string; // YYYY-MM-DD
  eventCount: number;
  cumulativeLow: number;
  cumulativeHigh: number;
  events: TimelineEventSummary[];
}

export interface RevenueTimelineSummary {
  totalLow: number;
  totalHigh: number;
  totalActual: number;
  eventCount: number;
  topEventType: RevenueEventType | null;
  milestones: Array<{
    label: string;
    date: string;
    value: number;
  }>;
  timeline: TimelinePoint[];
}

export const EVENT_TYPE_LABELS: Record<RevenueEventType, string> = {
  content_published: "Content Published",
  faq_created: "FAQ Created",
  insight_run: "Analysis Run",
  competitor_resolved: "Competitor Resolved",
  bulk_job: "Bulk Job Completed",
  manual: "Manual Entry",
};

export const EVENT_TYPE_ICONS: Record<RevenueEventType, string> = {
  content_published: "📄",
  faq_created: "❓",
  insight_run: "📊",
  competitor_resolved: "🏆",
  bulk_job: "⚡",
  manual: "✏️",
};

export function toDateString(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toISOString().slice(0, 10);
}

export function buildTimelinePoints(events: RawRevenueEvent[]): TimelinePoint[] {
  const byDate = new Map<string, TimelinePoint>();

  for (const ev of events) {
    const dateStr = toDateString(ev.occurredAt);
    if (!byDate.has(dateStr)) {
      byDate.set(dateStr, {
        date: dateStr,
        eventCount: 0,
        cumulativeLow: 0,
        cumulativeHigh: 0,
        events: [],
      });
    }
    const point = byDate.get(dateStr)!;
    point.eventCount += 1;
    point.events.push({
      type: ev.eventType,
      description: ev.description,
      low: ev.lowEstimate,
      high: ev.highEstimate,
      actual: ev.actualValue ?? undefined,
    });
  }

  // Sort by date ascending and compute cumulative totals
  const sorted = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  let runningLow = 0;
  let runningHigh = 0;
  for (const point of sorted) {
    for (const ev of point.events) {
      runningLow += ev.low;
      runningHigh += ev.high;
    }
    point.cumulativeLow = runningLow;
    point.cumulativeHigh = runningHigh;
  }

  return sorted;
}

export function detectMilestones(
  events: RawRevenueEvent[],
): Array<{ label: string; date: string; value: number }> {
  const milestones: Array<{ label: string; date: string; value: number }> = [];
  let cumulativeLow = 0;
  const thresholds = [100, 250, 500, 1000, 2500, 5000];
  let thresholdIdx = 0;

  for (const ev of [...events].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  )) {
    cumulativeLow += ev.lowEstimate;
    while (thresholdIdx < thresholds.length && cumulativeLow >= thresholds[thresholdIdx]) {
      milestones.push({
        label: `$${thresholds[thresholdIdx]} recovered`,
        date: toDateString(ev.occurredAt),
        value: thresholds[thresholdIdx],
      });
      thresholdIdx++;
    }
    // First content published milestone
    if (ev.eventType === "content_published" && milestones.find((m) => m.label === "First content published") === undefined) {
      milestones.push({ label: "First content published", date: toDateString(ev.occurredAt), value: 0 });
    }
    // First FAQ milestone
    if (ev.eventType === "faq_created" && milestones.find((m) => m.label === "First FAQ created") === undefined) {
      milestones.push({ label: "First FAQ created", date: toDateString(ev.occurredAt), value: 0 });
    }
  }

  return milestones;
}

export function buildRevenueTimelineSummary(events: RawRevenueEvent[]): RevenueTimelineSummary {
  const totalLow = events.reduce((s, e) => s + e.lowEstimate, 0);
  const totalHigh = events.reduce((s, e) => s + e.highEstimate, 0);
  const totalActual = events.reduce((s, e) => s + (e.actualValue ?? 0), 0);

  // Find top event type
  const typeCounts = new Map<RevenueEventType, number>();
  for (const ev of events) {
    typeCounts.set(ev.eventType, (typeCounts.get(ev.eventType) ?? 0) + 1);
  }
  let topEventType: RevenueEventType | null = null;
  let topCount = 0;
  for (const [type, count] of typeCounts) {
    if (count > topCount) {
      topCount = count;
      topEventType = type;
    }
  }

  return {
    totalLow: Math.round(totalLow),
    totalHigh: Math.round(totalHigh),
    totalActual: Math.round(totalActual),
    eventCount: events.length,
    topEventType,
    milestones: detectMilestones(events),
    timeline: buildTimelinePoints(events),
  };
}

export function filterEventsByType(
  events: RawRevenueEvent[],
  eventType: RevenueEventType,
): RawRevenueEvent[] {
  return events.filter((e) => e.eventType === eventType);
}

export function filterEventsByDateRange(
  events: RawRevenueEvent[],
  startDate: Date,
  endDate: Date,
): RawRevenueEvent[] {
  return events.filter((e) => {
    const d = typeof e.occurredAt === "string" ? new Date(e.occurredAt) : e.occurredAt;
    return d >= startDate && d <= endDate;
  });
}

export function aggregateByEventType(events: RawRevenueEvent[]): Array<{
  eventType: RevenueEventType;
  count: number;
  totalLow: number;
  totalHigh: number;
}> {
  const map = new Map<RevenueEventType, { count: number; totalLow: number; totalHigh: number }>();
  for (const ev of events) {
    const existing = map.get(ev.eventType) ?? { count: 0, totalLow: 0, totalHigh: 0 };
    map.set(ev.eventType, {
      count: existing.count + 1,
      totalLow: existing.totalLow + ev.lowEstimate,
      totalHigh: existing.totalHigh + ev.highEstimate,
    });
  }
  return Array.from(map.entries()).map(([eventType, data]) => ({ eventType, ...data }));
}
