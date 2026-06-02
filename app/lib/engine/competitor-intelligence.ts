// Competitor Intelligence Engine
// Classifies competitor mentions by intent and builds revenue opportunity estimates.
// All functions are pure — no DB or Shopify API calls. DB persistence happens in route actions.

export type IntentType =
  | "comparison"
  | "switching"
  | "price"
  | "feature"
  | "trust"
  | "general";

export interface ClassifiedMention {
  competitorName: string;
  quote: string;
  intentType: IntentType;
  occurredAt: Date;
  messageId?: string;
}

export interface CompetitorIntelligence {
  name: string;
  totalMentions: number;
  intentBreakdown: Record<IntentType, number>;
  switchingRisk: number;    // 0-100
  priceRisk: number;        // 0-100
  revenueAtRisk: number;    // estimated monthly USD
  affectedCustomers: number;
  growthRate: number;       // mention % change vs prior period
  opportunities: CompetitorOpportunityItem[];
  topQuote?: string;
}

export interface CompetitorOpportunityItem {
  type: "comparison_content" | "why_us_page" | "competitor_landing" | "price_objection";
  label: string;
  description: string;
  estimatedRevenue: number;
  priority: "high" | "medium" | "low";
}

// Keyword patterns per intent type.
const INTENT_PATTERNS: Record<IntentType, RegExp[]> = {
  switching: [
    /\b(switch(ing|ed)?\s+(to|from)|leav(ing|e)\s+for|mov(ing|e)\s+to|chang(ing|ed)?\s+to|go(ing)?\s+to\s+try)\b/i,
    /\b(cancel|cancell(ing|ed)|quit(ting)?|stop(ping)?\s+using)\b/i,
  ],
  price: [
    /\b(cheaper|less\s+expensive|better\s+price|lower\s+price|costs?\s+less|save\s+money|too\s+expensive|half\s+the\s+price)\b/i,
    /\b(found\s+a\s+better\s+price|lower\s+cost)\b/i,
  ],
  feature: [
    /\b(better\s+(quality|features?|product|design)|more\s+(features?|options?|durable|reliable)|superior|higher\s+quality)\b/i,
    /\b(which\s+is\s+better|what'?s\s+the\s+difference)\b/i,
  ],
  trust: [
    /\b(more\s+(reviews?|trusted?|reliable|reputable|established)|better\s+(reviews?|ratings?|reputation)|bad\s+(reviews?|experience))\b/i,
    /\b(heard\s+bad|read\s+bad|not\s+sure\s+if\s+you|worried\s+about|concerned\s+about|reputable|trustworthy)\b/i,
  ],
  comparison: [
    /\b(vs\.?|versus|compared?\s+(to|with)|similar\s+to|alternative\s+to|instead\s+of)\b/i,
    /\b(which\s+one|choose\s+between|deciding\s+between|compare)\b/i,
  ],
  general: [],
};

export function classifyIntent(text: string): IntentType {
  const lower = text.toLowerCase();
  // Check in priority order: specific intents first, general last.
  const PRIORITY: IntentType[] = ["switching", "price", "feature", "trust", "comparison"];
  for (const intent of PRIORITY) {
    if (INTENT_PATTERNS[intent].some((re) => re.test(lower))) return intent;
  }
  return "general";
}

export function classifyMentions(
  mentions: Array<{ name: string; quote?: string | null; occurredAt?: Date }>,
  messageId?: string,
): ClassifiedMention[] {
  return mentions.map((m) => ({
    competitorName: m.name,
    quote: m.quote ?? "",
    intentType: classifyIntent(m.quote ?? m.name),
    occurredAt: m.occurredAt ?? new Date(),
    messageId,
  }));
}

function intentBreakdown(mentions: ClassifiedMention[]): Record<IntentType, number> {
  const counts: Record<IntentType, number> = {
    comparison: 0,
    switching: 0,
    price: 0,
    feature: 0,
    trust: 0,
    general: 0,
  };
  for (const m of mentions) {
    counts[m.intentType] = (counts[m.intentType] ?? 0) + 1;
  }
  return counts;
}

function switchingRiskScore(breakdown: Record<IntentType, number>, total: number): number {
  if (total === 0) return 0;
  const switchWeight = breakdown.switching * 3 + breakdown.price * 2 + breakdown.feature * 1;
  return Math.min(100, Math.round((switchWeight / (total * 3)) * 100));
}

function priceRiskScore(breakdown: Record<IntentType, number>, total: number): number {
  if (total === 0) return 0;
  return Math.min(100, Math.round((breakdown.price / total) * 100 * 2.5));
}

// Revenue impact model:
// Switching intent costs ~$80/customer, price intent ~$60/customer, others ~$30/customer.
// Average order value assumed to be $85 if not otherwise known.
function estimateRevenue(breakdown: Record<IntentType, number>): number {
  return Math.round(
    breakdown.switching * 80 +
      breakdown.price * 60 +
      breakdown.feature * 40 +
      breakdown.trust * 30 +
      breakdown.comparison * 20 +
      breakdown.general * 10,
  );
}

function buildOpportunities(
  name: string,
  breakdown: Record<IntentType, number>,
  revenueAtRisk: number,
): CompetitorOpportunityItem[] {
  const opps: CompetitorOpportunityItem[] = [];

  if (breakdown.comparison + breakdown.feature > 0) {
    opps.push({
      type: "comparison_content",
      label: `${name} Comparison Page`,
      description: `Create a page comparing your store to ${name} on quality, policies, and support.`,
      estimatedRevenue: Math.round(revenueAtRisk * 0.35),
      priority: breakdown.comparison + breakdown.feature >= 3 ? "high" : "medium",
    });
  }

  if (breakdown.switching + breakdown.trust > 0) {
    opps.push({
      type: "why_us_page",
      label: "Why Buy From Us Page",
      description: `Publish a dedicated page addressing why customers choose you over ${name}.`,
      estimatedRevenue: Math.round(revenueAtRisk * 0.25),
      priority: breakdown.switching >= 2 ? "high" : "medium",
    });
  }

  if (breakdown.price >= 2) {
    opps.push({
      type: "price_objection",
      label: "Price Objection FAQ",
      description: `Add content that addresses the value difference between your store and ${name}.`,
      estimatedRevenue: Math.round(revenueAtRisk * 0.2),
      priority: "high",
    });
  }

  if (opps.length === 0) {
    opps.push({
      type: "competitor_landing",
      label: `${name} Alternative Landing Page`,
      description: `Create a landing page for shoppers searching for ${name} alternatives.`,
      estimatedRevenue: Math.round(revenueAtRisk * 0.15),
      priority: "low",
    });
  }

  return opps;
}

export function buildCompetitorIntelligence(
  name: string,
  mentions: ClassifiedMention[],
  priorPeriodMentions = 0,
): CompetitorIntelligence {
  const total = mentions.length;
  const breakdown = intentBreakdown(mentions);
  const switchingRisk = switchingRiskScore(breakdown, total);
  const priceRisk = priceRiskScore(breakdown, total);
  const revenueAtRisk = estimateRevenue(breakdown);
  const growthRate =
    priorPeriodMentions > 0
      ? Math.round(((total - priorPeriodMentions) / priorPeriodMentions) * 100)
      : total > 0
        ? 100
        : 0;
  const topQuote = mentions.find((m) => m.intentType !== "general")?.quote || mentions[0]?.quote;

  return {
    name,
    totalMentions: total,
    intentBreakdown: breakdown,
    switchingRisk,
    priceRisk,
    revenueAtRisk,
    affectedCustomers: total,
    growthRate,
    opportunities: buildOpportunities(name, breakdown, revenueAtRisk),
    topQuote,
  };
}

// Builds intelligence for all competitors from the raw engine output.
export function buildAllCompetitorIntelligence(
  competitors: Array<{ name: string; count: number; exampleQuote?: string | null }>,
): CompetitorIntelligence[] {
  return competitors
    .filter((c) => c.count > 0)
    .map((c) => {
      const fakeClassified: ClassifiedMention[] = Array.from({ length: c.count }, (_, i) => ({
        competitorName: c.name,
        quote: i === 0 ? (c.exampleQuote ?? c.name) : c.name,
        intentType: classifyIntent(c.exampleQuote ?? c.name),
        occurredAt: new Date(),
      }));
      return buildCompetitorIntelligence(c.name, fakeClassified);
    })
    .sort((a, b) => b.revenueAtRisk - a.revenueAtRisk);
}

export const INTENT_LABELS: Record<IntentType, string> = {
  comparison: "Comparison shopping",
  switching: "Switching intent",
  price: "Price sensitivity",
  feature: "Feature comparison",
  trust: "Trust concern",
  general: "General mention",
};
