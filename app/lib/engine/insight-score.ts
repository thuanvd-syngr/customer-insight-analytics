import type {
  FaqOpportunityResult,
  KeywordGroupResult,
  RevenueLeakageAlert,
} from "~/lib/types";

function clamp(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function computeInsightScore(args: {
  messageCount: number;
  keywordGroups: KeywordGroupResult[];
  leakage: RevenueLeakageAlert[];
  faq: FaqOpportunityResult[];
}): number {
  if (args.messageCount === 0) return 0;
  const frictionDensity =
    args.keywordGroups.reduce(
      (sum, group) => sum + group.count * group.frictionWeight,
      0,
    ) / args.messageCount;
  const leakagePenalty = args.leakage.reduce((sum, alert) => {
    if (alert.severity === "high") return sum + 12;
    if (alert.severity === "medium") return sum + 7;
    return sum + 3;
  }, 0);
  const faqPenalty = args.faq.reduce((sum, item) => sum + item.priority / 20, 0);

  return clamp(100 - frictionDensity * 24 - leakagePenalty - faqPenalty);
}
