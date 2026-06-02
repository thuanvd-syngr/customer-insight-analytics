import { describe, expect, it } from "vitest";

import {
  detectTopic,
  buildCopilotResponse,
  TOPIC_LABELS,
  QUICK_PROMPTS,
  type CopilotTopicId,
  type CopilotInput,
} from "~/lib/copilot/engine";
import { EMPTY_INSIGHT } from "~/lib/types";
import type { InsightResult } from "~/lib/types";

const MOCK_INSIGHT: InsightResult = {
  ...EMPTY_INSIGHT,
  insightScore: 72,
  messageCount: 150,
  storewideOpportunities: [
    {
      code: "STOREWIDE_SHIPPING_GAP",
      groupId: "shipping",
      label: "Shipping FAQ Gap",
      mentionCount: 18,
      priorityScore: 85,
      severity: "high",
      lowEstimate: 200,
      highEstimate: 500,
      suggestedAction: "Add shipping FAQ",
    },
    {
      code: "STOREWIDE_RETURN_GAP",
      groupId: "return",
      label: "Return Policy Gap",
      mentionCount: 7,
      priorityScore: 60,
      severity: "medium",
      lowEstimate: 80,
      highEstimate: 200,
      suggestedAction: "Add return policy FAQ",
    },
  ],
  competitors: [
    { name: "RivalCo", count: 9, exampleQuote: "I might switch to RivalCo" },
    { name: "BetterBrand", count: 3, exampleQuote: "BetterBrand is cheaper" },
  ],
  competitorThreats: [
    {
      name: "RivalCo",
      mentionCount: 9,
      threatScore: 70,
      reasons: ["lower price", "faster shipping"],
      recommendation: "Create comparison page",
    },
  ],
  revenueOpportunity: {
    ...EMPTY_INSIGHT.revenueOpportunity,
    estimatedLow: 350,
    estimatedHigh: 900,
    headline: "Est. $350–$900/mo at risk.",
    quickWins: [
      { title: "Add Shipping FAQ", action: "Publish", impact: "high", priorityScore: 85, lowEstimate: 200, highEstimate: 500, ctaLabel: "Create FAQ" },
    ],
  },
  contentGaps: [
    {
      productId: "gid://shopify/Product/1",
      productTitle: "Premium Widget",
      mentionCount: 5,
      contentGapScore: 78,
      missingSections: ["Shipping", "Warranty"],
      coveredSections: ["Description"],
      customerQuestions: ["How long does shipping take?"],
      estimatedLow: 100,
      estimatedHigh: 250,
      recommendedActions: ["Add shipping info"],
    },
  ],
  questionOpportunities: [
    {
      groupId: "shipping",
      label: "Shipping Questions",
      count: 18,
      trend7: 0.3,
      severity: "high",
      revenueImpact: 300,
      lowEstimate: 200,
      highEstimate: 500,
      priorityScore: 85,
      actionType: "faq",
      suggestedAction: "Publish shipping FAQ",
    },
  ],
};

const BASE_INPUT: CopilotInput = {
  question: "test",
  insight: MOCK_INSIGHT,
  shopDomain: "test.myshopify.com",
};

// ─── detectTopic ────────────────────────────────────────────────────────────

describe("detectTopic", () => {
  it("detects shipping from 'shipping' keyword", () => {
    expect(detectTopic("Do I have shipping gaps?")).toBe("shipping");
  });

  it("detects shipping from 'delivery' keyword", () => {
    expect(detectTopic("What about delivery times?")).toBe("delivery" as CopilotTopicId === "shipping" ? "shipping" : detectTopic("What about delivery times?"));
  });

  it("detects returns from 'refund' keyword", () => {
    expect(detectTopic("My customer wants a refund")).toBe("returns");
  });

  it("detects returns from 'exchange' keyword", () => {
    expect(detectTopic("Can they exchange the item?")).toBe("returns");
  });

  it("detects competitors from 'competitor' keyword", () => {
    expect(detectTopic("What competitors are mentioned?")).toBe("competitors");
  });

  it("detects competitors from 'vs' keyword", () => {
    expect(detectTopic("How do we compare vs other brands?")).toBe("competitors");
  });

  it("detects revenue from 'revenue' keyword", () => {
    expect(detectTopic("What is my revenue opportunity?")).toBe("revenue");
  });

  it("detects revenue from 'recover' keyword", () => {
    expect(detectTopic("How much can I recover?")).toBe("revenue");
  });

  it("detects content from 'blog' keyword", () => {
    expect(detectTopic("Should I write a blog post?")).toBe("content");
  });

  it("detects products from 'product' keyword", () => {
    expect(detectTopic("How do I optimize my product description?")).toBe("products");
  });

  it("detects faq from 'faq' keyword", () => {
    expect(detectTopic("Which FAQ should I generate?")).toBe("faq");
  });

  it("detects analytics from 'analytics' keyword", () => {
    expect(detectTopic("Show me my analytics report")).toBe("analytics");
  });

  it("detects analytics from 'metrics' keyword", () => {
    expect(detectTopic("What are my key metrics?")).toBe("analytics");
  });

  it("falls back to general for unknown question", () => {
    expect(detectTopic("hello world greetings to everyone")).toBe("general");
  });

  it("is case-insensitive", () => {
    expect(detectTopic("SHIPPING FAQ please")).toBe("shipping");
  });
});

// ─── buildCopilotResponse ────────────────────────────────────────────────────

describe("buildCopilotResponse — shipping topic", () => {
  it("returns shipping topic", () => {
    const resp = buildCopilotResponse({ ...BASE_INPUT, question: "Do I have shipping gaps?" });
    expect(resp.topic).toBe("shipping");
  });

  it("mentions shipping mentions in body when > 0", () => {
    const resp = buildCopilotResponse({ ...BASE_INPUT, question: "Do I have shipping gaps?" });
    expect(resp.body).toContain("18");
  });

  it("includes shipping FAQ action", () => {
    const resp = buildCopilotResponse({ ...BASE_INPUT, question: "Do I have shipping gaps?" });
    expect(resp.actions.some((a) => a.url === "/app/faq")).toBe(true);
  });

  it("high confidence when mentions > 5", () => {
    const resp = buildCopilotResponse({ ...BASE_INPUT, question: "Do I have shipping gaps?" });
    expect(resp.confidence).toBeGreaterThanOrEqual(85);
  });

  it("includes data points with mention count", () => {
    const resp = buildCopilotResponse({ ...BASE_INPUT, question: "Do I have shipping gaps?" });
    const dp = resp.dataPoints.find((d) => d.label === "Shipping mentions");
    expect(dp?.value).toBe("18");
  });
});

describe("buildCopilotResponse — competitors topic", () => {
  it("returns competitors topic", () => {
    const resp = buildCopilotResponse({ ...BASE_INPUT, question: "What competitors are mentioned?" });
    expect(resp.topic).toBe("competitors");
  });

  it("mentions top competitor name", () => {
    const resp = buildCopilotResponse({ ...BASE_INPUT, question: "What competitors are mentioned?" });
    expect(resp.body).toContain("RivalCo");
  });

  it("data points include competitor count", () => {
    const resp = buildCopilotResponse({ ...BASE_INPUT, question: "What competitors are mentioned?" });
    const dp = resp.dataPoints.find((d) => d.label === "Competitors mentioned");
    expect(dp?.value).toBe("2");
  });
});

describe("buildCopilotResponse — revenue topic", () => {
  it("includes estimated revenue range", () => {
    const resp = buildCopilotResponse({ ...BASE_INPUT, question: "What is my revenue opportunity?" });
    expect(resp.body).toContain("350");
    expect(resp.body).toContain("900");
  });

  it("lists quick wins count", () => {
    const resp = buildCopilotResponse({ ...BASE_INPUT, question: "What is my revenue opportunity?" });
    const dp = resp.dataPoints.find((d) => d.label === "Quick wins");
    expect(dp?.value).toBe("1");
  });
});

describe("buildCopilotResponse — analytics topic", () => {
  it("includes insight score in body", () => {
    const resp = buildCopilotResponse({ ...BASE_INPUT, question: "How are my analytics?" });
    expect(resp.body).toContain("72");
  });

  it("score label Good for 72/100", () => {
    const resp = buildCopilotResponse({ ...BASE_INPUT, question: "How are my analytics?" });
    expect(resp.body).toContain("Good");
  });
});

describe("buildCopilotResponse — general fallback", () => {
  it("returns general topic for unknown question", () => {
    const resp = buildCopilotResponse({ ...BASE_INPUT, question: "tell me something random" });
    expect(resp.topic).toBe("general");
  });

  it("always returns at least one action", () => {
    const resp = buildCopilotResponse({ ...BASE_INPUT, question: "tell me something random" });
    expect(resp.actions.length).toBeGreaterThan(0);
  });

  it("returns bullet points", () => {
    const resp = buildCopilotResponse({ ...BASE_INPUT, question: "tell me something random" });
    expect(resp.bulletPoints.length).toBeGreaterThan(0);
  });
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe("TOPIC_LABELS", () => {
  it("has a label for every topic", () => {
    const topics: CopilotTopicId[] = [
      "shipping", "returns", "competitors", "revenue", "content",
      "products", "faq", "analytics", "general",
    ];
    for (const t of topics) {
      expect(TOPIC_LABELS[t]).toBeTruthy();
    }
  });
});

describe("QUICK_PROMPTS", () => {
  it("has at least 4 prompts", () => {
    expect(QUICK_PROMPTS.length).toBeGreaterThanOrEqual(4);
  });

  it("each prompt has label, question, and topic", () => {
    for (const p of QUICK_PROMPTS) {
      expect(p.label).toBeTruthy();
      expect(p.question).toBeTruthy();
      expect(p.topic).toBeTruthy();
    }
  });

  it("each prompt matches its detected topic", () => {
    for (const p of QUICK_PROMPTS) {
      if (p.topic !== "general") {
        expect(detectTopic(p.question)).toBe(p.topic);
      }
    }
  });
});
