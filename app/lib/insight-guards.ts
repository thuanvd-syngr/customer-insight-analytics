import type { InsightResult } from "~/lib/types";

export function hasActionableRecoveryInsight(insight: InsightResult | null | undefined): boolean {
  if (!insight || insight.messageCount <= 0) return false;
  return (
    insight.keywordGroups.length > 0 ||
    insight.questionOpportunities.length > 0 ||
    insight.storewideOpportunities.length > 0 ||
    insight.recommendedActions.length > 0 ||
    insight.contentGaps.length > 0 ||
    insight.productConfusion.length > 0 ||
    insight.revenueOpportunity.drivers.length > 0 ||
    insight.revenueOpportunity.estimatedHigh > 0
  );
}
