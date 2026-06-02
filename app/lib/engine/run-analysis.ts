import type { AnalysisInput, InsightResult } from "~/lib/types";

import { detectCompetitors } from "./competitor";
import { detectFaqOpportunities } from "./faq-opportunity";
import { computeInsightScore } from "./insight-score";
import { buildKeywordGroupResults } from "./keyword-engine";
import { detectProductConfusion } from "./product-confusion";
import { detectRevenueLeakage } from "./revenue-leakage";
import { dailyVolume } from "./trend";
import { buildQuestionOpportunities, buildRecommendedActions, buildRevenueOpportunity } from "~/lib/revenue-opportunity.server";
import { buildCompetitorThreats, buildContentGapAnalysis, buildStorewideOpportunities } from "~/lib/recovery-engine.server";

export function runAnalysis(input: AnalysisInput): InsightResult {
  const now = input.now ?? new Date();
  const windowDays = input.windowDays ?? 30;
  const start = now.getTime() - windowDays * 86_400_000;
  const eligibleCustomerMessages = input.messages.filter(
    (message) =>
      message.source !== "product_text" &&
      message.source !== "product_tags",
  );
  const windowedCustomerMessages = eligibleCustomerMessages.filter(
    (message) =>
      message.occurredAt.getTime() > start &&
      message.occurredAt <= now,
  );
  const customerMessages = windowedCustomerMessages.length > 0
    ? windowedCustomerMessages
    : eligibleCustomerMessages;
  const keywordWindowDays = windowedCustomerMessages.length > 0 ? windowDays : 36500;
  const keywordGroups = buildKeywordGroupResults(customerMessages, now, keywordWindowDays);
  const productConfusion = detectProductConfusion(customerMessages, input.products);
  const faqOpportunities = detectFaqOpportunities(
    keywordGroups,
    input.products,
    input.pages ?? [],
  );
  const competitors = detectCompetitors(customerMessages, input.competitorTerms);
  const revenueLeakage = detectRevenueLeakage(keywordGroups);
  const revenueOpportunity = buildRevenueOpportunity(keywordGroups);
  const questionOpportunities = buildQuestionOpportunities(keywordGroups);
  const storewideOpportunities = buildStorewideOpportunities(questionOpportunities);
  const recommendedActions = buildRecommendedActions(questionOpportunities);
  const contentGaps = buildContentGapAnalysis({
    storeProducts: input.products,
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
    messageCount: customerMessages.length,
    keywordGroups,
    leakage: revenueLeakage,
    faq: faqOpportunities,
  });

  return {
    insightScore,
    windowDays,
    messageCount: customerMessages.length,
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
    storewideOpportunities,
    recommendedActions,
    contentGaps,
    competitorThreats,
    weeklyTrend: dailyVolume(customerMessages, now, 7),
  };
}
