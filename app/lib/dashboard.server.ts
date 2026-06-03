import { EMPTY_INSIGHT, normalizeInsightResult, type InsightResult } from "~/lib/types";

export function buildDashboardViewModel(input: {
  insight: Partial<InsightResult> | null | undefined;
  importedMessages: number;
  hasRun: boolean;
}) {
  const insight = normalizeInsightResult(input.insight ?? EMPTY_INSIGHT);
  const revenueOpportunity = insight.revenueOpportunity;
  const quickWins = revenueOpportunity.quickWins ?? [];
  const recommendedActions = insight.recommendedActions.length > 0
    ? insight.recommendedActions
    : quickWins.map((win, index) => ({
        id: win.groupId ?? `quick-win-${index}`,
        title: win.title,
        priority: win.impact,
        priorityScore: win.priorityScore ?? (win.impact === "high" ? 80 : win.impact === "medium" ? 55 : 25),
        mentions: revenueOpportunity.topFriction?.count ?? 0,
        lowEstimate: win.lowEstimate ?? revenueOpportunity.estimatedLow,
        highEstimate: win.highEstimate ?? revenueOpportunity.estimatedHigh,
        recommendedAction: win.action,
        ctaLabel: win.ctaLabel ?? "Fix this issue",
        targetUrl: "/app/faq",
        groupId: win.groupId,
      }));
  const needsAnalysis = !input.hasRun && input.importedMessages > 0;
  const isEmpty = !input.hasRun && input.importedMessages === 0;

  return {
    insight,
    importedMessages: input.importedMessages,
    hasRun: input.hasRun,
    isEmpty,
    needsAnalysis,
    revenueOpportunity,
    quickWins,
    recommendedActions,
    showRevenueOpportunity: !isEmpty && !needsAnalysis,
    showQuickWins: !isEmpty && !needsAnalysis && quickWins.length > 0,
  };
}
