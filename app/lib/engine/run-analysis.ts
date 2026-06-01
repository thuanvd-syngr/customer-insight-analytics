import type { AnalysisInput, InsightResult } from "~/lib/types";

import { detectCompetitors } from "./competitor";
import { detectFaqOpportunities } from "./faq-opportunity";
import { computeInsightScore } from "./insight-score";
import { buildKeywordGroupResults } from "./keyword-engine";
import { detectProductConfusion } from "./product-confusion";
import { detectRevenueLeakage } from "./revenue-leakage";
import { dailyVolume } from "./trend";
import { buildQuestionOpportunities, buildRecommendedActions, buildRevenueOpportunity } from "~/lib/revenue-opportunity.server";
import { buildCompetitorThreats, buildContentGapAnalysis } from "~/lib/recovery-engine.server";

export function runAnalysis(input: AnalysisInput): InsightResult {
  const now = input.now ?? new Date();
  const windowDays = input.windowDays ?? 30;
  const start = now.getTime() - windowDays * 86_400_000;
  const messages = input.messages.filter(
    (message) => message.occurredAt.getTime() > start && message.occurredAt <= now,
  );
  const keywordGroups = buildKeywordGroupResults(input.messages, now, windowDays);
  const productConfusion = detectProductConfusion(messages, input.products);
  const faqOpportunities = detectFaqOpportunities(
    keywordGroups,
    input.products,
    input.pages ?? [],
  );
  const competitors = detectCompetitors(messages, input.competitorTerms);
  const revenueLeakage = detectRevenueLeakage(keywordGroups);
  const revenueOpportunity = buildRevenueOpportunity(keywordGroups);
  const questionOpportunities = buildQuestionOpportunities(keywordGroups);
  const recommendedActions = buildRecommendedActions(questionOpportunities);
  const contentGaps = buildContentGapAnalysis({
    products: productConfusion,
    faqOpportunities,
    questionOpportunities,
  });
  const competitorThreats = buildCompetitorThreats(
    competitors,
    productConfusion.filter((product) =>
      product.topGroups.some((group) => group === "competitor" || group === "compare"),
    ).length,
  );
  const insightScore = computeInsightScore({
    messageCount: messages.length,
    keywordGroups,
    leakage: revenueLeakage,
    faq: faqOpportunities,
  });

  return {
    insightScore,
    windowDays,
    messageCount: messages.length,
    generatedAt: now.toISOString(),
    topQuestions: keywordGroups.slice(0, 5).map((group) => ({
      text: group.label ? group.label : group.groupId,
      count: group.count,
      groupId: group.groupId,
    })),
    keywordGroups,
    productConfusion,
    faqOpportunities,
    competitors,
    revenueLeakage,
    revenueOpportunity,
    questionOpportunities,
    recommendedActions,
    contentGaps,
    competitorThreats,
    weeklyTrend: dailyVolume(input.messages, now, 7),
  };
}
