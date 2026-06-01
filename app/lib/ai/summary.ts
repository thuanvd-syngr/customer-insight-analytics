import type { WeeklySummaryInput } from "./types";

export function buildMockSummary(input: WeeklySummaryInput): string {
  const topGroups = input.insight.keywordGroups
    .slice(0, 5)
    .map((group) => `- ${group.label}: ${group.count} mentions`)
    .join("\n");
  const leakage = input.insight.revenueLeakage
    .slice(0, 3)
    .map((alert) => `- ${alert.label}: ${alert.severity} risk`)
    .join("\n");

  return [
    `# Weekly customer insight summary`,
    ``,
    `Shop: ${input.shopDomain}`,
    `Period: ${input.weekStart} to ${input.weekEnd}`,
    `Insight score: ${input.insight.insightScore}/100 from ${input.insight.messageCount} messages.`,
    ``,
    `## Top friction themes`,
    topGroups || "- No recurring friction themes found.",
    ``,
    `## Revenue leakage`,
    leakage || "- No rising leakage alerts this week.",
    ``,
    `## Recommended actions`,
    ...input.insight.faqOpportunities.slice(0, 3).map((item) => `- Add FAQ: ${item.question}`),
  ].join("\n");
}

export function buildSummaryPrompt(input: WeeklySummaryInput): {
  system: string;
  user: string;
} {
  return {
    system:
      "You write concise weekly Shopify customer insight summaries for merchants. Focus on purchase friction and concrete actions.",
    user: JSON.stringify({
      shopDomain: input.shopDomain,
      weekStart: input.weekStart,
      weekEnd: input.weekEnd,
      insight: input.insight,
    }),
  };
}
