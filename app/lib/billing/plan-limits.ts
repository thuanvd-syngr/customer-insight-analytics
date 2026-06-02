// Phase 11 — Extended plan limits + feature gate helpers.
// Extends the existing billing/plans.ts without modifying it.

import { PLANS } from "./plans";
import type { PlanId } from "./plans";
import type { GateResult } from "./gating";

/** Features gated beyond the existing PlanFeatures. */
export interface ExtendedPlanLimits {
  /** Max manually-saved content drafts (GeneratedFaq). */
  contentDrafts: number;
  /** Max active opportunity tracking. */
  maxOpportunities: number;
  /** Whether the Product FAQ Widget (theme extension) is accessible. */
  productFaqWidget: boolean;
  /** Whether bulk job creation is allowed. */
  bulkActions: boolean;
  /** Whether AI product section optimization is allowed. */
  aiProductOptimize: boolean;
  /** Whether automated email reports can be scheduled. */
  emailReports: boolean;
  /** Whether monthly/quarterly executive reports are available. */
  executiveReports: boolean;
  /** Whether auto-publish is allowed without manual confirmation. */
  autoPublish: boolean;
}

export const PLAN_EXTENDED_LIMITS: Record<PlanId, ExtendedPlanLimits> = {
  free: {
    contentDrafts: 3,
    maxOpportunities: 10,
    productFaqWidget: false,
    bulkActions: false,
    aiProductOptimize: false,
    emailReports: false,
    executiveReports: false,
    autoPublish: false,
  },
  starter: {
    contentDrafts: 50,
    maxOpportunities: 100,
    productFaqWidget: false,
    bulkActions: false,
    aiProductOptimize: false,
    emailReports: false,
    executiveReports: false,
    autoPublish: false,
  },
  growth: {
    contentDrafts: 500,
    maxOpportunities: 1000,
    productFaqWidget: true,
    bulkActions: false,
    aiProductOptimize: true,
    emailReports: true,
    executiveReports: false,
    autoPublish: false,
  },
  pro: {
    contentDrafts: 99999,
    maxOpportunities: 99999,
    productFaqWidget: true,
    bulkActions: true,
    aiProductOptimize: true,
    emailReports: true,
    executiveReports: true,
    autoPublish: true,
  },
};

function gate(allowed: boolean, reason: string): GateResult {
  return { allowed, reason: allowed ? undefined : reason };
}

export function canUseProductFaqWidget(plan: PlanId): GateResult {
  const ok = PLAN_EXTENDED_LIMITS[plan].productFaqWidget;
  return gate(ok, "Product FAQ Widget requires Growth or Pro plan.");
}

export function canUseBulkActions(plan: PlanId): GateResult {
  const ok = PLAN_EXTENDED_LIMITS[plan].bulkActions || PLANS[plan].features.bulkPublishing;
  return gate(ok, "Bulk actions require Pro plan.");
}

export function canUseAIProductOptimize(plan: PlanId): GateResult {
  const ok = PLAN_EXTENDED_LIMITS[plan].aiProductOptimize;
  return gate(ok, "AI product optimization requires Growth or Pro plan.");
}

export function canUseEmailReports(plan: PlanId): GateResult {
  const ok = PLAN_EXTENDED_LIMITS[plan].emailReports;
  return gate(ok, "Email reports require Growth or Pro plan.");
}

export function canUseExecutiveReports(plan: PlanId): GateResult {
  const ok = PLAN_EXTENDED_LIMITS[plan].executiveReports || PLANS[plan].features.executiveReports;
  return gate(ok, "Executive reports require Pro plan.");
}

export function canUseAutoPublish(plan: PlanId): GateResult {
  const ok = PLAN_EXTENDED_LIMITS[plan].autoPublish;
  return gate(ok, "Auto-publish requires Pro plan.");
}

/** Generic feature gate for any boolean key in PlanFeatures. */
export function canFeature(
  plan: PlanId,
  feature: keyof typeof PLANS[PlanId]["features"],
): boolean {
  return Boolean(PLANS[plan]?.features[feature]);
}

export function getContentDraftLimit(plan: PlanId): number {
  return PLAN_EXTENDED_LIMITS[plan].contentDrafts;
}

export function getOpportunityLimit(plan: PlanId): number {
  return PLAN_EXTENDED_LIMITS[plan].maxOpportunities;
}
