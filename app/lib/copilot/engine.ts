import type { InsightResult } from "~/lib/types";

export type CopilotTopicId =
  | "shipping"
  | "returns"
  | "competitors"
  | "revenue"
  | "content"
  | "products"
  | "faq"
  | "analytics"
  | "general";

export interface CopilotAction {
  label: string;
  url: string;
  priority: "high" | "medium" | "low";
}

export interface CopilotDataPoint {
  label: string;
  value: string;
}

export interface CopilotResponse {
  topic: CopilotTopicId;
  headline: string;
  body: string;
  bulletPoints: string[];
  actions: CopilotAction[];
  confidence: number; // 0-100
  dataPoints: CopilotDataPoint[];
}

export interface CopilotInput {
  question: string;
  insight: InsightResult;
  shopDomain: string;
}

const TOPIC_KEYWORDS: Record<CopilotTopicId, string[]> = {
  shipping: ["shipping", "delivery", "ship", "freight", "tracking", "carrier"],
  returns: ["return", "refund", "exchange", "money back", "policy", "refunded"],
  competitors: ["competitor", "compare", "vs", "versus", "alternative", "better", "cheaper", "switch"],
  revenue: ["revenue", "money", "sales", "income", "earn", "profit", "recover", "loss", "risk"],
  content: ["content", "page", "blog", "publish", "write", "article", "text", "copy"],
  products: ["product", "item", "catalog", "description", "listing", "optimize", "seo"],
  faq: ["faq", "question", "answer", "help", "how to", "frequently asked"],
  analytics: ["analytics", "metrics", "data", "performance", "report", "dashboard", "stats"],
  general: [],
};

export function detectTopic(question: string): CopilotTopicId {
  const lower = question.toLowerCase();
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS) as Array<[CopilotTopicId, string[]]>) {
    if (topic === "general") continue;
    if (keywords.some((k) => lower.includes(k))) return topic;
  }
  return "general";
}

export function buildCopilotResponse(input: CopilotInput): CopilotResponse {
  const topic = detectTopic(input.question);
  return buildTopicResponse(topic, input);
}

function buildTopicResponse(topic: CopilotTopicId, input: CopilotInput): CopilotResponse {
  const { insight } = input;

  switch (topic) {
    case "shipping": {
      const gap = insight.storewideOpportunities.find((o) => o.groupId === "shipping");
      const mentions = gap?.mentionCount ?? 0;
      return {
        topic,
        headline: mentions > 0 ? "Shipping FAQ Gap Detected" : "Shipping Coverage Looks OK",
        body: mentions > 0
          ? `${mentions} customers asked about shipping but found no clear answer. Publishing a shipping FAQ could recover $${gap?.lowEstimate ?? 0}–$${gap?.highEstimate ?? 0}/mo.`
          : "No major shipping confusion detected. Consider proactively publishing a shipping policy FAQ to prevent future friction.",
        bulletPoints: [
          "Add a dedicated shipping FAQ page with delivery timeframes",
          "Include carrier names and tracking instructions",
          "Address international shipping and duties questions",
          mentions > 5
            ? `${mentions} customers specifically asked about shipping in the last ${insight.windowDays} days`
            : "Monitor shipping question trends monthly",
        ],
        actions: [
          { label: "Generate Shipping FAQ", url: "/app/faq", priority: "high" },
          { label: "Publish Policy Page", url: "/app/publish", priority: "medium" },
        ],
        confidence: mentions > 5 ? 90 : 60,
        dataPoints: [
          { label: "Shipping mentions", value: String(mentions) },
          {
            label: "Est. monthly recovery",
            value: gap ? `$${gap.lowEstimate}–$${gap.highEstimate}` : "N/A",
          },
        ],
      };
    }

    case "returns": {
      const gap = insight.storewideOpportunities.find((o) => o.groupId === "return");
      const mentions = gap?.mentionCount ?? 0;
      return {
        topic,
        headline: mentions > 0 ? "Return Policy Confusion Detected" : "Return Policy Clarity",
        body: mentions > 0
          ? `${mentions} return-related questions found. A clear return policy FAQ reduces pre-purchase anxiety and cart abandonment.`
          : "Return policy questions are low right now. Keep your policy visible on all product pages.",
        bulletPoints: [
          "Publish a clear return & exchange policy page",
          "Add return window and conditions upfront (e.g. 30 days, unopened)",
          "Include restocking fee or free-return policy",
          "Link return policy from all product detail pages",
        ],
        actions: [
          { label: "Create Return FAQ", url: "/app/faq", priority: "high" },
          { label: "View Opportunities", url: "/app/insights", priority: "medium" },
        ],
        confidence: mentions > 5 ? 85 : 55,
        dataPoints: [
          { label: "Return mentions", value: String(mentions) },
          {
            label: "Est. recovery",
            value: gap ? `$${gap.lowEstimate}–$${gap.highEstimate}` : "N/A",
          },
        ],
      };
    }

    case "competitors": {
      const competitorCount = insight.competitors.length;
      const topCompetitor = insight.competitors[0];
      const threatCount = insight.competitorThreats?.length ?? 0;
      return {
        topic,
        headline: competitorCount > 0 ? "Competitor Mentions Detected" : "No Active Competitor Threats",
        body: competitorCount > 0
          ? `${competitorCount} competitor${competitorCount > 1 ? "s" : ""} mentioned by customers. "${topCompetitor?.name}" leads with ${topCompetitor?.count} mentions. Comparison content can recover hesitant buyers.`
          : "No competitor mentions detected in recent messages. This is a strong signal — maintain your messaging advantage.",
        bulletPoints: [
          "Create comparison pages addressing top competitors",
          "Publish a why-us page with unique value propositions",
          "Address price and feature objections proactively",
          competitorCount > 0
            ? `"${topCompetitor?.name}" appears most frequently — prioritize this first`
            : "Set up competitor tracking in Settings to monitor future mentions",
        ],
        actions: [
          { label: "View Competitors", url: "/app/competitors", priority: "high" },
          { label: "Generate Comparison Content", url: "/app/faq", priority: "medium" },
        ],
        confidence: competitorCount > 0 ? 88 : 50,
        dataPoints: [
          { label: "Competitors mentioned", value: String(competitorCount) },
          { label: "Active threats", value: String(threatCount) },
          { label: "Top competitor", value: topCompetitor?.name ?? "None" },
          { label: "Top mentions", value: String(topCompetitor?.count ?? 0) },
        ],
      };
    }

    case "revenue": {
      const rev = insight.revenueOpportunity;
      const winCount = rev.quickWins?.length ?? 0;
      return {
        topic,
        headline: rev.estimatedHigh > 0 ? "Revenue Recovery Opportunities" : "Revenue Data Not Yet Available",
        body: rev.estimatedHigh > 0
          ? `Your store has an estimated $${rev.estimatedLow}–$${rev.estimatedHigh}/month in recoverable revenue. ${rev.headline}`
          : "Run an analysis with customer messages to surface revenue recovery opportunities.",
        bulletPoints: [
          "Address top friction points first — highest ROI per effort",
          "Publish missing FAQ content to capture hesitant buyers",
          "Monitor insight score weekly for improvement trends",
          winCount > 0
            ? `${winCount} quick win${winCount > 1 ? "s" : ""} ready to action now`
            : "Sync Shopify orders to unlock more data",
        ],
        actions: [
          { label: "View Opportunities", url: "/app/insights", priority: "high" },
          { label: "Revenue Timeline", url: "/app/roi", priority: "medium" },
        ],
        confidence: rev.estimatedHigh > 0 ? 85 : 40,
        dataPoints: [
          {
            label: "Est. monthly recovery",
            value: `$${rev.estimatedLow}–$${rev.estimatedHigh}`,
          },
          { label: "Quick wins", value: String(winCount) },
          { label: "Insight score", value: String(insight.insightScore) },
        ],
      };
    }

    case "content": {
      const gaps = insight.contentGaps;
      const topGap = gaps[0];
      return {
        topic,
        headline: gaps.length > 0 ? "Content Gaps Identified" : "Content Coverage Looks Strong",
        body: gaps.length > 0
          ? `${gaps.length} product${gaps.length > 1 ? "s" : ""} need content attention. Focus on the highest content gap score first to maximize recovery.`
          : "No significant content gaps detected. Your product descriptions appear comprehensive.",
        bulletPoints: [
          "Fill gaps in product descriptions for high-confusion products",
          "Add FAQ sections to products with the most customer questions",
          "Publish blog articles addressing common topic groups",
          topGap
            ? `"${topGap.productTitle}" has the highest gap score (${topGap.contentGapScore}/100)`
            : "Maintain current content coverage and review monthly",
        ],
        actions: [
          { label: "View Content Gaps", url: "/app/insights", priority: "high" },
          { label: "Recovery Library", url: "/app/library", priority: "medium" },
        ],
        confidence: gaps.length > 0 ? 82 : 65,
        dataPoints: [
          { label: "Products with gaps", value: String(gaps.length) },
          { label: "Avg gap score", value: gaps.length > 0
            ? String(Math.round(gaps.reduce((s, g) => s + g.contentGapScore, 0) / gaps.length))
            : "0",
          },
        ],
      };
    }

    case "faq": {
      const opps = insight.storewideOpportunities;
      const highSeverity = opps.filter((o) => o.severity === "high").length;
      return {
        topic,
        headline: opps.length > 0 ? "FAQ Opportunities Ready" : "No Urgent FAQ Gaps",
        body: opps.length > 0
          ? `${opps.length} FAQ opportunit${opps.length > 1 ? "ies" : "y"} identified — ${highSeverity} high severity. Start with high-severity items for maximum revenue impact.`
          : "No urgent FAQ gaps right now. Consider adding FAQs for your most popular products proactively.",
        bulletPoints: [
          "Generate FAQ content for high-severity groups first",
          "Use AI generation for faster, SEO-optimized content",
          "Publish FAQ as product metafield for search visibility",
          "Track FAQ performance and usage in the content library",
        ],
        actions: [
          { label: "Generate FAQ", url: "/app/faq", priority: "high" },
          { label: "Bulk Generate", url: "/app/bulk", priority: "medium" },
        ],
        confidence: opps.length > 0 ? 88 : 70,
        dataPoints: [
          { label: "FAQ opportunities", value: String(opps.length) },
          { label: "High severity", value: String(highSeverity) },
        ],
      };
    }

    case "analytics": {
      const score = insight.insightScore;
      const scoreLabel = score >= 80 ? "Excellent" : score >= 60 ? "Good" : score >= 40 ? "Needs Attention" : "Critical";
      return {
        topic,
        headline: "Store Performance Overview",
        body: `Insight score: ${score}/100 (${scoreLabel}). Analyzed ${insight.messageCount} customer messages over ${insight.windowDays} days. Use the Analytics dashboard for detailed breakdowns.`,
        bulletPoints: [
          "Monitor insight score weekly — target 80+ for healthy store",
          "Track published content count as a leading indicator",
          "Review revenue recovery timeline monthly for ROI clarity",
          "Compare competitor mention trends to benchmark positioning",
        ],
        actions: [
          { label: "Analytics Dashboard", url: "/app/analytics", priority: "high" },
          { label: "Revenue Timeline", url: "/app/roi", priority: "medium" },
        ],
        confidence: 75,
        dataPoints: [
          { label: "Insight score", value: `${score}/100` },
          { label: "Score status", value: scoreLabel },
          { label: "Messages analyzed", value: String(insight.messageCount) },
          { label: "Analysis window", value: `${insight.windowDays} days` },
        ],
      };
    }

    case "products": {
      const productCount = insight.contentGaps.length;
      const confusionCount = insight.productConfusion?.length ?? 0;
      return {
        topic,
        headline: productCount > 0 ? "Product Optimization Opportunities" : "Products Look Well Optimized",
        body: productCount > 0
          ? `${productCount} products have optimization opportunities. Use AI product optimization to improve descriptions, SEO titles, and meta descriptions.`
          : "Product content looks comprehensive. Consider adding structured FAQ sections to top products.",
        bulletPoints: [
          "Optimize product descriptions to answer common questions",
          "Add benefit-focused content for high-confusion products",
          "Use AI to generate SEO-optimized titles and meta descriptions",
          "Add warranty, shipping, and return info directly on product pages",
        ],
        actions: [
          { label: "View Products", url: "/app/products", priority: "high" },
          { label: "AI Optimization", url: "/app/products", priority: "medium" },
        ],
        confidence: productCount > 0 ? 80 : 60,
        dataPoints: [
          { label: "Products to optimize", value: String(productCount) },
          { label: "Confused products", value: String(confusionCount) },
        ],
      };
    }

    default: {
      return {
        topic: "general",
        headline: "Revenue Recovery Copilot",
        body: `I can help you recover revenue by identifying and fixing customer friction points. Your current insight score is ${insight.insightScore}/100. Ask me about shipping, returns, competitors, revenue opportunities, or content strategy.`,
        bulletPoints: [
          "Ask about shipping or return policy gaps",
          "Get competitor threat analysis",
          "Understand your revenue recovery opportunity",
          "Learn which products need content attention",
        ],
        actions: [
          { label: "Run Analysis", url: "/app", priority: "high" },
          { label: "View Insights", url: "/app/insights", priority: "medium" },
        ],
        confidence: 70,
        dataPoints: [
          { label: "Insight score", value: String(insight.insightScore) },
          { label: "Messages analyzed", value: String(insight.messageCount) },
        ],
      };
    }
  }
}

export const TOPIC_LABELS: Record<CopilotTopicId, string> = {
  shipping: "Shipping",
  returns: "Returns & Refunds",
  competitors: "Competitor Intelligence",
  revenue: "Revenue Recovery",
  content: "Content Strategy",
  products: "Product Optimization",
  faq: "FAQ Generation",
  analytics: "Analytics",
  general: "General",
};

export const QUICK_PROMPTS: Array<{
  label: string;
  question: string;
  topic: CopilotTopicId;
}> = [
  {
    label: "Revenue opportunity",
    question: "What is my revenue recovery opportunity this month?",
    topic: "revenue",
  },
  {
    label: "Shipping gaps",
    question: "Do I have shipping FAQ gaps that are costing me sales?",
    topic: "shipping",
  },
  {
    label: "Competitor threats",
    question: "Which competitors are being mentioned by my customers?",
    topic: "competitors",
  },
  {
    label: "Content strategy",
    question: "Which pages and blog articles should I publish next?",
    topic: "content",
  },
  {
    label: "FAQ generation",
    question: "Which FAQs should I generate first for maximum impact?",
    topic: "faq",
  },
  {
    label: "Analytics overview",
    question: "Show me an analytics report of my store performance.",
    topic: "analytics",
  },
];
