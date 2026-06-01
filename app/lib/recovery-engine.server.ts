import type {
  CompetitorMentionResult,
  CompetitorThreat,
  ContentGapAnalysis,
  FaqOpportunityResult,
  ProductConfusionResult,
  QuestionOpportunity,
} from "~/lib/types";

const SECTION_LABELS: Record<string, string> = {
  size: "Size Guide",
  return: "Return Policy",
  refund: "Refund Policy",
  shipping: "Shipping Timeline",
  delivery: "Delivery Timeline",
  payment: "Payment Options",
  stock: "Stock Availability",
  ingredient: "Ingredients",
  caffeine: "Caffeine Content",
  usage: "Usage Instructions",
  compare: "Comparison Details",
  competitor: "Quality Comparison",
};

export function opportunityRangeForGroups(
  groupIds: string[],
  opportunities: QuestionOpportunity[],
) {
  const relevant = opportunities.filter((item) => groupIds.includes(item.groupId));
  return {
    low: relevant.reduce((sum, item) => sum + item.lowEstimate, 0),
    high: relevant.reduce((sum, item) => sum + item.highEstimate, 0),
  };
}

export function buildContentGapAnalysis(input: {
  products: ProductConfusionResult[];
  faqOpportunities: FaqOpportunityResult[];
  questionOpportunities: QuestionOpportunity[];
}): ContentGapAnalysis[] {
  return input.products.slice(0, 20).map((product) => {
    const productFaqGaps = input.faqOpportunities.filter(
      (faq) => !faq.hasContent && (!faq.productId || faq.productId === product.productId),
    );
    const groupIds = Array.from(
      new Set([...product.topGroups, ...productFaqGaps.map((faq) => faq.groupId)]),
    );
    const missingSections = groupIds
      .map((groupId) => SECTION_LABELS[groupId] ?? `${groupId} FAQ`)
      .slice(0, 6);
    const coveredSections = input.faqOpportunities
      .filter((faq) => faq.hasContent && product.topGroups.includes(faq.groupId))
      .map((faq) => SECTION_LABELS[faq.groupId] ?? faq.groupId);
    const range = opportunityRangeForGroups(groupIds, input.questionOpportunities);
    const weightedGap = missingSections.length * 14 + product.confusionScore * 0.45 + product.mentionCount * 2;
    return {
      productId: product.productId,
      productTitle: product.productTitle,
      contentGapScore: Math.max(0, Math.min(100, Math.round(weightedGap))),
      missingSections,
      coveredSections,
      customerQuestions: product.topGroups.map((groupId) => SECTION_LABELS[groupId] ?? groupId),
      estimatedLow: range.low,
      estimatedHigh: range.high,
      recommendedActions: missingSections.slice(0, 3).map((section) => `Generate ${section}`),
    };
  }).sort((a, b) => b.contentGapScore - a.contentGapScore);
}

function reasonFromQuote(quote?: string): string[] {
  const text = (quote ?? "").toLowerCase();
  const reasons: string[] = [];
  if (/(cheap|cheaper|price|cost|temu|amazon)/.test(text)) reasons.push("Lower price");
  if (/(fast|shipping|delivery|prime)/.test(text)) reasons.push("Faster delivery");
  if (/(handmade|etsy|quality|material)/.test(text)) reasons.push("Perceived quality or uniqueness");
  if (/(review|rating|trust|safe)/.test(text)) reasons.push("Trust and proof");
  return reasons.length ? reasons : ["Comparison shopping"];
}

export function buildCompetitorThreats(
  competitors: CompetitorMentionResult[],
  comparedProductCount: number,
): CompetitorThreat[] {
  return competitors.map((item) => {
    const reasons = reasonFromQuote(item.exampleQuote);
    const threatScore = Math.min(
      100,
      Math.round(item.count * 16 + comparedProductCount * 5 + reasons.length * 8),
    );
    return {
      name: item.name,
      mentionCount: item.count,
      threatScore,
      reasons,
      recommendation: reasons.includes("Lower price")
        ? "Highlight quality differences, guarantees, and total value near the buy button."
        : "Add comparison copy that explains why shoppers should choose this store.",
      exampleQuote: item.exampleQuote,
    };
  }).sort((a, b) => b.threatScore - a.threatScore);
}
