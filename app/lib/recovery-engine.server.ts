import type {
  CompetitorMentionResult,
  CompetitorThreat,
  ContentGapAnalysis,
  FaqOpportunityResult,
  KeywordGroupId,
  ProductConfusionResult,
  ProductInput,
  QuestionOpportunity,
} from "~/lib/types";
import { KEYWORD_GROUPS_BY_ID } from "~/lib/engine/keyword-groups";
import { normalizeText } from "~/lib/engine/normalize";
import { tokenize } from "~/lib/engine/tokenize";
import {
  STOREWIDE_GROUP_IDS,
  scoreProductTopicRelevance,
} from "~/lib/engine/product-matcher";
import { moneyRange } from "~/components/format";

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
  storeProducts?: ProductInput[];
  products: ProductConfusionResult[];
  faqOpportunities: FaqOpportunityResult[];
  questionOpportunities: QuestionOpportunity[];
}): ContentGapAnalysis[] {
  console.info("Product recovery analysis", {
    productsAnalyzed: input.storeProducts?.length ?? input.products.length,
    productConfusionFindings: input.products.length,
    faqOpportunities: input.faqOpportunities.length,
    questionOpportunities: input.questionOpportunities.length,
  });
  const confusionById = new Map(input.products.map((product) => [product.productId, product]));
  // Only product-specific question groups are used for gap-only products.
  // Storewide topics (shipping, delivery, payment, return, refund, discount, warranty)
  // are surfaced in Insights/FAQ but must NOT be assigned per-product when there
  // is no direct customer mention of that product.
  const questionGroups = input.questionOpportunities.slice(0, 8);
  const productSpecificQuestionGroups = questionGroups.filter(
    (item) => !STOREWIDE_GROUP_IDS.has(item.groupId),
  );

  const productPool = input.storeProducts?.length
    ? input.storeProducts.slice(0, 1000).map((product) => {
        const confused = confusionById.get(product.id);
        let topGroups: string[];
        if (confused) {
          // Direct confusion: keep all groups including storewide ones
          topGroups = confused.topGroups;
        } else if (product) {
          // Gap-only: assign product-specific topics that score above threshold
          topGroups = productSpecificQuestionGroups
            .filter((item) => scoreProductTopicRelevance(product, item.groupId as KeywordGroupId) >= 25)
            .slice(0, 4)
            .map((item) => item.groupId);
        } else {
          topGroups = [];
        }
        return {
          productId: product.id,
          productTitle: product.title,
          mentionCount: confused?.mentionCount ?? 0,
          confusionScore: confused?.confusionScore ?? 0,
          topGroups,
          exampleQuote: confused?.exampleQuote,
          product,
          isDirectConfusion: Boolean(confused),
        };
      })
    : input.products.map((product) => ({
        ...product,
        product: null as ProductInput | null,
        isDirectConfusion: true,
      }));

  const gaps = productPool.slice(0, 1000).map((product) => {
    const rawText = [
      product.productTitle,
      product.product?.description ?? "",
      product.product?.tags?.join(" ") ?? "",
      product.product?.productType ?? "",
      product.product?.collections?.join(" ") ?? "",
    ].join(" ");
    const text = normalizeText(rawText);
    const tokens = new Set(tokenize(rawText, { removeStopWords: false, minLength: 2 }));

    const productFaqGaps = input.faqOpportunities.filter((faq) => {
      if (faq.hasContent) return false;
      if (faq.productId && faq.productId !== product.productId) return false;
      // For gap-only products, filter out storewide FAQ gaps
      if (!product.isDirectConfusion && STOREWIDE_GROUP_IDS.has(faq.groupId as KeywordGroupId)) return false;
      // For gap-only, also filter by product relevance
      if (!product.isDirectConfusion && product.product) {
        const score = scoreProductTopicRelevance(product.product, faq.groupId as KeywordGroupId);
        if (score < 25) return false;
      }
      return true;
    });

    // For direct confusion products: keep all groups + top question groups
    // For gap-only products: only product-specific groups already in topGroups
    const groupIds = Array.from(
      new Set([
        ...product.topGroups,
        ...productFaqGaps.map((faq) => faq.groupId),
        ...(product.isDirectConfusion ? questionGroups.slice(0, 4).map((item) => item.groupId) : []),
      ]),
    );

    if (groupIds.length === 0) return null;

    const missingGroupIds = groupIds.filter((groupId) => {
      const definition = KEYWORD_GROUPS_BY_ID[groupId as keyof typeof KEYWORD_GROUPS_BY_ID];
      if (!definition) return true;
      return !definition.terms.some((term: string) => {
        const normalizedTerm = normalizeText(term);
        return normalizedTerm.includes(" ")
          ? text.includes(normalizedTerm)
          : tokens.has(normalizedTerm);
      });
    });

    if (missingGroupIds.length === 0) return null;

    const coveredGroupIds = groupIds.filter((groupId) => !missingGroupIds.includes(groupId));
    const missingSections = missingGroupIds
      .map((groupId) => SECTION_LABELS[groupId] ?? `${groupId} FAQ`)
      .slice(0, 6);
    const coveredSections = coveredGroupIds.map((groupId) => SECTION_LABELS[groupId] ?? groupId);
    const range = opportunityRangeForGroups(missingGroupIds, input.questionOpportunities);
    const weightedGap =
      missingSections.length * 14 +
      product.confusionScore * 0.45 +
      product.mentionCount * 2 +
      questionGroups.filter((item) => missingGroupIds.includes(item.groupId)).reduce((sum, item) => sum + item.priorityScore * 0.12, 0);
    const score = Math.max(0, Math.min(100, Math.round(weightedGap)));

    // customerQuestions: real question text from keyword group definitions,
    // not section label strings. Used as example quotes in the UI.
    const customerQuestions = groupIds.map(
      (groupId) => KEYWORD_GROUPS_BY_ID[groupId as keyof typeof KEYWORD_GROUPS_BY_ID]?.question ?? SECTION_LABELS[groupId] ?? groupId,
    );

    return {
      productId: product.productId,
      productTitle: product.productTitle,
      mentionCount: product.mentionCount,
      contentGapScore: score,
      missingSections,
      coveredSections,
      customerQuestions,
      estimatedLow: range.low,
      estimatedHigh: range.high,
      recommendedActions: missingSections.slice(0, 3).map((section) => `Generate ${section}`),
      expectedImpact:
        range.high > 0
          ? `${moneyRange(range.low, range.high)}/mo`
          : score >= 50
            ? "Reduce repeated pre-purchase questions"
            : "Improve product page completeness",
      timeToFix: missingSections.length <= 1 ? "10 min" : missingSections.length <= 3 ? "20 min" : "30 min",
    };
  })
    .filter((gap): gap is NonNullable<typeof gap> => gap !== null && gap.missingSections.length > 0)
    .sort((a, b) => b.contentGapScore - a.contentGapScore)
    .slice(0, 50);

  console.info("Product recovery findings", {
    productsAnalyzed: productPool.length,
    findingsGenerated: gaps.length,
    findingsSkipped: Math.max(0, productPool.length - gaps.length),
  });
  return gaps;
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
