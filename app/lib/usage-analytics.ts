// Feature usage tracking and conversion funnel — pure logic, no DB access.
// Routes persist UsageEvent records; this file aggregates and analyses them.

export type FeatureId =
  | "insight_run"
  | "faq_generated"
  | "content_published"
  | "bulk_job_started"
  | "copilot_used"
  | "marketing_generated"
  | "competitor_viewed"
  | "roi_viewed"
  | "library_viewed"
  | "onboarding_completed"
  | "billing_upgraded";

export interface UsageEventRecord {
  id: string;
  shopId: string;
  featureId: string;
  metadata: string | null; // JSON
  occurredAt: string | Date;
}

export interface FeatureUsageSummary {
  featureId: FeatureId;
  count: number;
  label: string;
}

export type FunnelStage =
  | "installed"
  | "analyzed"
  | "opportunity_found"
  | "content_published"
  | "revenue_tracked";

export interface ConversionFunnelStage {
  stage: FunnelStage;
  label: string;
  reached: boolean;
  order: number;
}

export interface ConversionFunnel {
  stages: ConversionFunnelStage[];
  farthestStage: FunnelStage;
  dropoffStage: FunnelStage | null;
  completionRate: number; // 0-100
}

export const FEATURE_LABELS: Record<FeatureId, string> = {
  insight_run:          "Analysis Run",
  faq_generated:        "FAQ Generated",
  content_published:    "Content Published",
  bulk_job_started:     "Bulk Job Started",
  copilot_used:         "AI Copilot Used",
  marketing_generated:  "Marketing Asset Generated",
  competitor_viewed:    "Competitor View",
  roi_viewed:           "Revenue Timeline View",
  library_viewed:       "Content Library View",
  onboarding_completed: "Onboarding Completed",
  billing_upgraded:     "Billing Upgraded",
};

const FUNNEL_STAGE_DEFS: Array<Omit<ConversionFunnelStage, "reached">> = [
  { stage: "installed",          label: "App Installed",          order: 1 },
  { stage: "analyzed",           label: "First Analysis Run",     order: 2 },
  { stage: "opportunity_found",  label: "Opportunity Identified", order: 3 },
  { stage: "content_published",  label: "Content Published",      order: 4 },
  { stage: "revenue_tracked",    label: "Revenue Tracked",        order: 5 },
];

const FUNNEL_TRIGGERS: Record<FunnelStage, FeatureId[]> = {
  installed:          [],
  analyzed:           ["insight_run"],
  opportunity_found:  ["insight_run"],
  content_published:  ["content_published", "faq_generated"],
  revenue_tracked:    ["roi_viewed"],
};

function stageReached(stage: FunnelStage, seen: Set<FeatureId>): boolean {
  if (stage === "installed") return true;
  return FUNNEL_TRIGGERS[stage].some((f) => seen.has(f));
}

export function buildConversionFunnel(
  events: Pick<UsageEventRecord, "featureId">[],
): ConversionFunnel {
  const seen = new Set<FeatureId>(events.map((e) => e.featureId as FeatureId));
  const stages: ConversionFunnelStage[] = FUNNEL_STAGE_DEFS.map((def) => ({
    ...def,
    reached: stageReached(def.stage, seen),
  }));

  const reachedStages = stages.filter((s) => s.reached);
  const farthestStage = reachedStages[reachedStages.length - 1]?.stage ?? "installed";
  const dropoffStage = stages.find((s) => !s.reached)?.stage ?? null;
  const completionRate = Math.round((reachedStages.length / stages.length) * 100);

  return { stages, farthestStage, dropoffStage, completionRate };
}

export function aggregateUsageByFeature(
  events: Pick<UsageEventRecord, "featureId">[],
): FeatureUsageSummary[] {
  const counts = new Map<FeatureId, number>();
  for (const e of events) {
    const fid = e.featureId as FeatureId;
    counts.set(fid, (counts.get(fid) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([featureId, count]) => ({
      featureId,
      count,
      label: FEATURE_LABELS[featureId] ?? featureId,
    }))
    .sort((a, b) => b.count - a.count);
}

export function serializeMetadata(
  metadata: Record<string, string | number | boolean> | undefined,
): string | null {
  if (!metadata || Object.keys(metadata).length === 0) return null;
  try { return JSON.stringify(metadata); } catch { return null; }
}

export function parseMetadata(
  json: string | null,
): Record<string, string | number | boolean> | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, string | number | boolean>;
    }
    return null;
  } catch { return null; }
}

/** Top-N features by usage count. */
export function topFeatures(events: Pick<UsageEventRecord, "featureId">[], n = 5): FeatureUsageSummary[] {
  return aggregateUsageByFeature(events).slice(0, n);
}

/** How many distinct days has this feature been used? */
export function usageDayCount(events: UsageEventRecord[], featureId: FeatureId): number {
  const days = new Set<string>();
  for (const e of events) {
    if (e.featureId === featureId) {
      days.add(new Date(e.occurredAt).toISOString().slice(0, 10));
    }
  }
  return days.size;
}
