import { BillingInterval } from "@shopify/shopify-app-remix/server";

// Plan catalog + Shopify managed-pricing billing config.
// This is the single source of truth for plan ids, prices, and feature limits.

export type PlanId = "free" | "starter" | "growth" | "pro";

export interface PlanFeatures {
  /** Max ImportedMessages countable per calendar month. */
  messagesPerMonth: number;
  /** Max analysis runs per ISO week. */
  analysesPerWeek: number;
  /** Cadence label shown in the UI. */
  analysisFrequency: "weekly" | "daily";
  /** Whether "Generate weekly AI summary" is allowed. */
  aiWeeklySummary: boolean;
  /** Whether report export is allowed. */
  exportReport: boolean;
}

export interface PlanDefinition {
  id: PlanId;
  /** Display name AND the Shopify billing plan key used by billing.* calls. */
  name: string;
  /** Monthly price in USD (0 for Free). */
  price: number;
  trialDays: number;
  /** Short marketing blurb for the billing page. */
  tagline: string;
  features: PlanFeatures;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    name: "Free",
    price: 0,
    trialDays: 0,
    tagline: "Try the rule-based engine on a small store.",
    features: {
      messagesPerMonth: 100,
      analysesPerWeek: 1,
      analysisFrequency: "weekly",
      aiWeeklySummary: false,
      exportReport: false,
    },
  },
  starter: {
    id: "starter",
    name: "Starter",
    price: 9,
    trialDays: 7,
    tagline: "Daily insights for growing stores.",
    features: {
      messagesPerMonth: 1000,
      analysesPerWeek: 7,
      analysisFrequency: "daily",
      aiWeeklySummary: false,
      exportReport: false,
    },
  },
  growth: {
    id: "growth",
    name: "Growth",
    price: 29,
    trialDays: 7,
    tagline: "Weekly AI summaries on top of daily analysis.",
    features: {
      messagesPerMonth: 10000,
      analysesPerWeek: 7,
      analysisFrequency: "daily",
      aiWeeklySummary: true,
      exportReport: false,
    },
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: 79,
    trialDays: 7,
    tagline: "High volume, AI summaries, and report export.",
    features: {
      messagesPerMonth: 50000,
      analysesPerWeek: 7,
      analysisFrequency: "daily",
      aiWeeklySummary: true,
      exportReport: true,
    },
  },
};

export const PLAN_IDS: PlanId[] = ["free", "starter", "growth", "pro"];

/** Plans that incur a Shopify charge (everything except Free). */
export const PAID_PLAN_IDS: PlanId[] = ["starter", "growth", "pro"];

/** Shopify billing plan keys for the paid plans (their display names). */
export const PAID_PLAN_NAMES: string[] = PAID_PLAN_IDS.map(
  (id) => PLANS[id].name,
);

/**
 * Shopify managed-pricing billing config passed to shopifyApp({ billing }).
 * Only paid plans appear here; Free has no charge. Each plan is a single
 * recurring (Every30Days) line item.
 */
export const BILLING_CONFIG = Object.fromEntries(
  PAID_PLAN_IDS.map((id) => {
    const plan = PLANS[id];
    return [
      plan.name,
      {
        trialDays: plan.trialDays,
        lineItems: [
          {
            amount: plan.price,
            currencyCode: "USD",
            // `as const` keeps the literal member type so the billing config
            // resolves to a recurring (not usage) line item.
            interval: BillingInterval.Every30Days as const,
          },
        ],
      },
    ];
  }),
);

/** Map a Shopify subscription/plan name back to a PlanId. */
export function planIdFromName(name?: string | null): PlanId {
  if (!name) return "free";
  const match = PLAN_IDS.find(
    (id) => PLANS[id].name.toLowerCase() === name.toLowerCase(),
  );
  return match ?? "free";
}

export function getPlan(id: PlanId): PlanDefinition {
  return PLANS[id];
}
