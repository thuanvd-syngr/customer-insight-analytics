import { PLANS, PLAN_IDS, type PlanId } from "./plans";

export interface UsageSnapshot {
  plan: PlanId;
  messagesThisMonth: number;
  analysesThisWeek: number;
  aiSummariesThisMonth: number;
}

export interface GateResult {
  allowed: boolean;
  reason?: string;
  limit?: number;
  used?: number;
  remaining?: number;
}

function gate(used: number, limit: number, allowed: boolean, reason: string): GateResult {
  return {
    allowed,
    reason: allowed ? undefined : reason,
    limit,
    used,
    remaining: Math.max(0, limit - used),
  };
}

export function canImportMessages(snapshot: UsageSnapshot, addCount: number): GateResult {
  const limit = PLANS[snapshot.plan].features.messagesPerMonth;
  const used = snapshot.messagesThisMonth + addCount;
  return gate(used, limit, used <= limit, "Monthly message limit reached.");
}

export function canRunAnalysis(snapshot: UsageSnapshot): GateResult {
  const limit = PLANS[snapshot.plan].features.analysesPerWeek;
  return gate(
    snapshot.analysesThisWeek,
    limit,
    snapshot.analysesThisWeek < limit,
    "Weekly analysis limit reached.",
  );
}

export function canGenerateAISummary(snapshot: UsageSnapshot): GateResult {
  const allowed = PLANS[snapshot.plan].features.aiWeeklySummary;
  return { allowed, reason: allowed ? undefined : "AI weekly summaries require Growth or Pro." };
}

export function canExportReport(plan: PlanId): GateResult {
  const allowed = PLANS[plan].features.exportReport;
  return { allowed, reason: allowed ? undefined : "Report export requires Pro." };
}

export function resolvePlan(opts: {
  activePlanId?: PlanId | null;
  devOverride?: string | null;
  devOverrideEnabled?: boolean;
  isProduction: boolean;
}): PlanId {
  if (
    !opts.isProduction &&
    opts.devOverrideEnabled === true &&
    PLAN_IDS.includes(opts.devOverride as PlanId)
  ) {
    return opts.devOverride as PlanId;
  }
  return opts.activePlanId ?? "free";
}

/** Billing test mode is explicit in production and defaults on in development. */
export function isBillingTestMode(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.SHOPIFY_BILLING_TEST !== undefined) {
    return env.SHOPIFY_BILLING_TEST === "true";
  }
  return env.NODE_ENV !== "production";
}

/** Dev plan overrides require an explicit enable flag and never apply in production. */
export function getDevPlanOverride(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env.NODE_ENV === "production") return null;
  if (env.ENABLE_DEV_PLAN_OVERRIDE !== "true") return null;
  return env.DEV_PLAN_OVERRIDE ?? null;
}
