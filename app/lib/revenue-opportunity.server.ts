import type {
  KeywordGroupId,
  KeywordGroupResult,
  QuestionOpportunity,
  RecommendedAction,
  QuickWin,
  RevenueOpportunity,
} from "~/lib/types";

const DEFAULT_AOV = 72;

const GROUP_CONVERSION_LIFT: Partial<Record<KeywordGroupId, { low: number; high: number }>> = {
  payment: { low: 0.18, high: 0.52 },
  shipping: { low: 0.16, high: 0.42 },
  delivery: { low: 0.14, high: 0.36 },
  refund: { low: 0.13, high: 0.34 },
  return: { low: 0.13, high: 0.34 },
  stock: { low: 0.12, high: 0.32 },
  size: { low: 0.12, high: 0.3 },
  compare: { low: 0.1, high: 0.28 },
  competitor: { low: 0.1, high: 0.3 },
  ingredient: { low: 0.08, high: 0.22 },
  caffeine: { low: 0.08, high: 0.22 },
  usage: { low: 0.07, high: 0.18 },
};

const ACTIONS: Partial<Record<KeywordGroupId, string>> = {
  shipping: "Add Shipping FAQ",
  delivery: "Clarify Delivery Timeline",
  refund: "Add Refund Policy FAQ",
  return: "Add Return Policy FAQ",
  stock: "Add Restock Notice",
  compare: "Add Product Comparison Section",
  competitor: "Add Competitor Comparison Section",
  payment: "Clarify Payment Options",
  size: "Improve Size Guide",
  ingredient: "Expand Ingredient Details",
  usage: "Add Usage Instructions",
};

const ACTION_TYPES: Partial<Record<KeywordGroupId, QuestionOpportunity["actionType"]>> = {
  compare: "comparison",
  competitor: "comparison",
  payment: "faq",
  return: "policy",
  refund: "policy",
  shipping: "faq",
  size: "content_block",
  stock: "publish",
};

function moneyRange(low: number, high: number): string {
  return `$${Math.round(low).toLocaleString("en-US")}-$${Math.round(high).toLocaleString("en-US")}/mo`;
}

function severityFor(impact: number, trend7: number): "low" | "medium" | "high" {
  if (impact >= 500 || trend7 >= 1) return "high";
  if (impact >= 180 || trend7 >= 0.35) return "medium";
  return "low";
}

function severityForScore(score: number, impact: number, trend7: number): "low" | "medium" | "high" {
  if (score >= 67) return "high";
  if (score >= 40) return "medium";
  return severityFor(impact, trend7);
}

function suggestedAction(groupId: KeywordGroupId, label: string): string {
  return ACTIONS[groupId] ?? `Add ${label} FAQ`;
}

function estimateRange(group: KeywordGroupResult, averageOrderValue = DEFAULT_AOV) {
  const lift = GROUP_CONVERSION_LIFT[group.groupId] ?? { low: 0.06, high: 0.16 };
  const trendMultiplier = 1 + Math.min(1.5, Math.max(0, group.trend7 || 0)) * 0.35;
  const frictionMultiplier = 0.8 + Math.max(0, group.frictionWeight || 0) * 0.6;
  const low = Math.max(20, group.count * averageOrderValue * lift.low * trendMultiplier * frictionMultiplier);
  const high = Math.max(low + 30, group.count * averageOrderValue * lift.high * trendMultiplier * frictionMultiplier);
  return {
    lowEstimate: Math.round(low),
    highEstimate: Math.round(high),
    revenueImpact: Math.round((low + high) / 2),
  };
}

function priorityScore(input: {
  count: number;
  trend7: number;
  revenueImpact: number;
  frictionWeight: number;
}): number {
  const volume = Math.min(35, input.count * 3);
  const trend = Math.min(20, Math.max(0, input.trend7) * 20);
  const revenue = Math.min(30, input.revenueImpact / 18);
  const friction = Math.min(15, input.frictionWeight * 15);
  return Math.max(1, Math.min(100, Math.round(volume + trend + revenue + friction)));
}

export function buildQuestionOpportunities(
  keywordGroups: KeywordGroupResult[],
): QuestionOpportunity[] {
  return keywordGroups
    .filter((group) => group.count > 0)
    .map((group) => {
      const estimate = estimateRange(group);
      const score = priorityScore({
        count: group.count,
        trend7: group.trend7,
        revenueImpact: estimate.revenueImpact,
        frictionWeight: group.frictionWeight,
      });
      return {
        groupId: group.groupId,
        label: group.label,
        count: group.count,
        trend7: group.trend7,
        severity: severityForScore(score, estimate.revenueImpact, group.trend7),
        revenueImpact: estimate.revenueImpact,
        lowEstimate: estimate.lowEstimate,
        highEstimate: estimate.highEstimate,
        priorityScore: score,
        actionType: ACTION_TYPES[group.groupId] ?? "faq",
        suggestedAction: suggestedAction(group.groupId, group.label),
        exampleQuote: group.exampleQuote,
      };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore || b.revenueImpact - a.revenueImpact);
}

export function buildRecommendedActions(
  questionOpportunities: QuestionOpportunity[],
): RecommendedAction[] {
  return questionOpportunities.slice(0, 6).map((item) => ({
    id: item.groupId,
    title:
      item.actionType === "content_block"
        ? `Add ${item.label} Guide`
        : item.actionType === "comparison"
          ? `Defend ${item.label} Comparisons`
          : item.suggestedAction,
    priority: item.severity,
    priorityScore: item.priorityScore,
    mentions: item.count,
    lowEstimate: item.lowEstimate,
    highEstimate: item.highEstimate,
    recommendedAction: item.suggestedAction,
    ctaLabel:
      item.actionType === "content_block"
        ? "Generate content"
        : item.actionType === "publish"
          ? "Prepare publish draft"
          : "Fix this issue",
    targetUrl: item.actionType === "comparison" ? "/app/competitors" : "/app/faq",
    groupId: item.groupId,
  }));
}

export function buildRevenueOpportunity(
  keywordGroups: KeywordGroupResult[],
): RevenueOpportunity {
  const opportunities = buildQuestionOpportunities(keywordGroups);
  const drivers = opportunities
    .filter((item) =>
      ["shipping", "refund", "return", "stock", "competitor", "compare"].includes(item.groupId),
    )
    .slice(0, 6)
    .map((item) => ({
      groupId: item.groupId,
      label: item.label,
      count: item.count,
      revenueImpact: item.revenueImpact,
      lowEstimate: item.lowEstimate,
      highEstimate: item.highEstimate,
      priorityScore: item.priorityScore,
    }));
  const monthlyAtRisk = drivers.reduce((sum, item) => sum + item.revenueImpact, 0);
  const estimatedLow = drivers.reduce((sum, item) => sum + item.lowEstimate, 0);
  const estimatedHigh = drivers.reduce((sum, item) => sum + item.highEstimate, 0);
  const topFriction = opportunities[0]
    ? {
        label: opportunities[0].label,
        trend7: opportunities[0].trend7,
        count: opportunities[0].count,
      }
    : null;
  const quickWins: QuickWin[] = opportunities.slice(0, 3).map((item) => ({
    title: item.suggestedAction,
    action: item.exampleQuote
      ? `Use customer wording: "${item.exampleQuote.slice(0, 96)}"`
      : "Add this answer to product pages, FAQ, and support macros.",
    impact: item.severity,
    priorityScore: item.priorityScore,
    lowEstimate: item.lowEstimate,
    highEstimate: item.highEstimate,
    ctaLabel: item.actionType === "content_block" ? "Generate content" : "Fix this issue",
    groupId: item.groupId,
  }));

  return {
    amount: monthlyAtRisk,
    currency: "USD",
    monthlyAtRisk,
    estimatedLow,
    estimatedHigh,
    headline: monthlyAtRisk > 0 ? `${moneyRange(estimatedLow, estimatedHigh)} estimated opportunity` : "Add customer questions to reveal recovery actions",
    summary: monthlyAtRisk > 0
      ? "Prioritized from customer questions that can delay checkout or trigger support tickets."
      : "Add customer questions or sync Shopify data to discover opportunities.",
    topFriction,
    quickWins,
    drivers,
    opportunities: drivers.map((driver) => ({
      label: driver.label,
      revenueImpact: driver.revenueImpact,
      lowEstimate: driver.lowEstimate,
      highEstimate: driver.highEstimate,
    })),
    alerts: [],
  };
}
