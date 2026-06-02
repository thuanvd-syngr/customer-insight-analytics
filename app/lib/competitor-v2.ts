// Competitor Tracking V2 — configurable tracking, confidence loss scores, comparison opps.
// Pure functions; no DB or network calls.

import type { CompetitorMentionResult, CompetitorThreat, LeakageSeverity } from "~/lib/types";

export type ComparisonOpportunityType =
  | "comparison_page"
  | "why_us_page"
  | "price_objection_faq"
  | "feature_comparison"
  | "trust_content"
  | "competitor_landing";

export type ConfidenceLossLevel = "none" | "low" | "moderate" | "high" | "critical";

export interface ConfidenceLossFactor {
  label: string;
  score: number; // 0-100 contribution
  weight: number; // 0-1 weight
}

export interface ConfidenceLossScore {
  competitorName: string;
  totalScore: number; // 0-100
  level: ConfidenceLossLevel;
  factors: ConfidenceLossFactor[];
  recommendation: string;
}

export interface ComparisonOpportunity {
  competitorName: string;
  opportunityType: ComparisonOpportunityType;
  title: string;
  description: string;
  priority: LeakageSeverity;
  estimatedRevenueLow: number;
  estimatedRevenueHigh: number;
  suggestedContent: string;
}

export interface CompetitorV2Summary {
  totalCompetitors: number;
  totalMentions: number;
  criticalThreats: number;
  avgConfidenceLoss: number;
  topCompetitorName: string | null;
}

export const COMPARISON_OPPORTUNITY_LABELS: Record<ComparisonOpportunityType, string> = {
  comparison_page: "Head-to-Head Comparison Page",
  why_us_page: "Why Choose Us Page",
  price_objection_faq: "Price Objection FAQ",
  feature_comparison: "Feature Comparison Table",
  trust_content: "Trust & Social Proof Content",
  competitor_landing: "Competitor Landing Page",
};

const CONFIDENCE_LOSS_THRESHOLDS: Array<{ max: number; level: ConfidenceLossLevel }> = [
  { max: 10, level: "none" },
  { max: 30, level: "low" },
  { max: 55, level: "moderate" },
  { max: 75, level: "high" },
  { max: 100, level: "critical" },
];

export function getConfidenceLossLevel(score: number): ConfidenceLossLevel {
  for (const t of CONFIDENCE_LOSS_THRESHOLDS) {
    if (score <= t.max) return t.level;
  }
  return "critical";
}

export function calculateConfidenceLossScore(
  competitor: CompetitorMentionResult,
  threat?: CompetitorThreat,
): ConfidenceLossScore {
  const factors: ConfidenceLossFactor[] = [];

  // Factor 1: raw mention count (0-40 points)
  const mentionScore = Math.min(40, competitor.count * 4);
  factors.push({
    label: "Mention frequency",
    score: mentionScore,
    weight: 0.4,
  });

  // Factor 2: threat score if available (0-30 points)
  const threatScore = threat ? Math.min(30, (threat.threatScore / 100) * 30) : 0;
  factors.push({
    label: "Threat severity",
    score: threatScore,
    weight: 0.3,
  });

  // Factor 3: switching signal (presence of switching language, 0-20 points)
  const hasSwitchingSignal = Boolean(
    competitor.exampleQuote &&
      /switch|changi|moving|going to|try.*instead|better than/i.test(competitor.exampleQuote),
  );
  const switchScore = hasSwitchingSignal ? 20 : 0;
  factors.push({
    label: "Switching intent signal",
    score: switchScore,
    weight: 0.2,
  });

  // Factor 4: reasons breadth (0-10 points)
  const reasonsScore = threat ? Math.min(10, threat.reasons.length * 3) : 0;
  factors.push({
    label: "Threat reasons breadth",
    score: reasonsScore,
    weight: 0.1,
  });

  const totalScore = Math.round(mentionScore + threatScore + switchScore + reasonsScore);
  const level = getConfidenceLossLevel(totalScore);

  const recommendation =
    level === "critical"
      ? `Urgent: Create dedicated "${competitor.name}" comparison content immediately.`
      : level === "high"
        ? `Prioritize comparison content and a "Why Us" page addressing ${competitor.name}.`
        : level === "moderate"
          ? `Build a feature comparison table and price objection FAQ for ${competitor.name}.`
          : level === "low"
            ? `Monitor ${competitor.name} mentions and prepare comparison content.`
            : `${competitor.name} mentions are minimal — no action required right now.`;

  return { competitorName: competitor.name, totalScore, level, factors, recommendation };
}

export function buildComparisonOpportunities(
  competitor: CompetitorMentionResult,
  confidenceLoss: ConfidenceLossScore,
): ComparisonOpportunity[] {
  const opportunities: ComparisonOpportunity[] = [];
  const { level, competitorName } = confidenceLoss;
  const mentionCount = competitor.count;

  // High-value: comparison page
  opportunities.push({
    competitorName,
    opportunityType: "comparison_page",
    title: `${competitorName} vs. Your Store — Comparison Page`,
    description: `Create a comparison page addressing the ${mentionCount} customers who mentioned ${competitorName}.`,
    priority: level === "critical" || level === "high" ? "high" : "medium",
    estimatedRevenueLow: mentionCount * 10,
    estimatedRevenueHigh: mentionCount * 30,
    suggestedContent: `Write a factual comparison covering price, shipping speed, return policy, and unique features. Include customer testimonials.`,
  });

  // Why us page for moderate+ threats
  if (["moderate", "high", "critical"].includes(level)) {
    opportunities.push({
      competitorName,
      opportunityType: "why_us_page",
      title: "Why Choose Us Over Competitors",
      description: `A why-us page addressing the ${mentionCount} customers comparing options.`,
      priority: level === "critical" ? "high" : "medium",
      estimatedRevenueLow: mentionCount * 8,
      estimatedRevenueHigh: mentionCount * 25,
      suggestedContent: `Highlight unique value propositions, customer success stories, and key differentiators vs. ${competitorName}.`,
    });
  }

  // Price objection FAQ
  if (mentionCount >= 3) {
    opportunities.push({
      competitorName,
      opportunityType: "price_objection_faq",
      title: `Price & Value FAQ — ${competitorName} Comparison`,
      description: "Address common price-related objections raised when customers compare options.",
      priority: "medium",
      estimatedRevenueLow: mentionCount * 5,
      estimatedRevenueHigh: mentionCount * 15,
      suggestedContent: `Answer: "Is your store cheaper than ${competitorName}?", "Do you offer the same return policy?", "What makes you worth the price?"`,
    });
  }

  // Trust content for high threats
  if (["high", "critical"].includes(level)) {
    opportunities.push({
      competitorName,
      opportunityType: "trust_content",
      title: "Trust & Social Proof Content",
      description: "Build trust with reviews, certifications, and guarantees to counter competitor preference.",
      priority: "medium",
      estimatedRevenueLow: mentionCount * 12,
      estimatedRevenueHigh: mentionCount * 35,
      suggestedContent: `Add verified reviews, industry certifications, money-back guarantee, and comparison testimonials.`,
    });
  }

  return opportunities;
}

export function calculateCompetitorV2Summary(
  competitors: CompetitorMentionResult[],
  scores: ConfidenceLossScore[],
): CompetitorV2Summary {
  const scoreMap = new Map(scores.map((s) => [s.competitorName, s]));
  const criticalThreats = scores.filter((s) => s.level === "critical" || s.level === "high").length;
  const avgConfidenceLoss =
    scores.length > 0
      ? Math.round(scores.reduce((sum, s) => sum + s.totalScore, 0) / scores.length)
      : 0;
  const topCompetitor = competitors.sort((a, b) => b.count - a.count)[0];

  return {
    totalCompetitors: competitors.length,
    totalMentions: competitors.reduce((s, c) => s + c.count, 0),
    criticalThreats,
    avgConfidenceLoss,
    topCompetitorName: topCompetitor?.name ?? null,
  };
}

export function rankCompetitorsByThreat(
  competitors: CompetitorMentionResult[],
  threats: CompetitorThreat[],
): Array<{ competitor: CompetitorMentionResult; threat?: CompetitorThreat; confidenceLoss: ConfidenceLossScore }> {
  const threatMap = new Map(threats.map((t) => [t.name, t]));
  return competitors
    .map((c) => {
      const threat = threatMap.get(c.name);
      const confidenceLoss = calculateConfidenceLossScore(c, threat);
      return { competitor: c, threat, confidenceLoss };
    })
    .sort((a, b) => b.confidenceLoss.totalScore - a.confidenceLoss.totalScore);
}
