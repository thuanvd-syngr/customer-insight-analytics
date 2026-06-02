/**
 * Reviewer / demo mode — when a store has no real data, surfaces pre-built
 * sample insights so Shopify app reviewers and new merchants immediately
 * understand what the app does.
 *
 * Rules:
 * - Never writes sample data to the DB (read-only overlay).
 * - Only activates when importedMessage count AND insightRun count are both 0.
 * - Caller passes `isSampleMode` back to the UI so a "Sample data" banner
 *   can be shown.
 */

import type { PrismaClient } from "@prisma/client";
import type { InsightResult } from "~/lib/types";

export async function isReviewerMode(
  db: PrismaClient,
  shopId: string,
): Promise<boolean> {
  try {
    const [msgCount, runCount] = await Promise.all([
      db.importedMessage.count({ where: { shopId } }),
      db.insightRun.count({ where: { shopId } }),
    ]);
    return msgCount === 0 && runCount === 0;
  } catch {
    return false;
  }
}

export function buildSampleInsight(now = new Date()): InsightResult {
  const day = (daysAgo: number) => {
    const d = new Date(now.getTime() - daysAgo * 86_400_000);
    return d.toISOString().slice(0, 10);
  };
  return {
    insightScore: 42,
    windowDays: 30,
    messageCount: 45,
    generatedAt: now.toISOString(),
    topQuestions: [
      { text: "Do you ship to Canada?", count: 8, groupId: "shipping" },
      { text: "What is the return policy?", count: 7, groupId: "return" },
      { text: "Can I pay with PayPal?", count: 5, groupId: "payment" },
    ],
    keywordGroups: [
      {
        groupId: "shipping",
        label: "Shipping & Delivery",
        count: 14,
        uniqueMessages: 12,
        keywords: [
          { keyword: "shipping", count: 8 },
          { keyword: "delivery", count: 6 },
        ],
        trend7: 0.15,
        trend30: 0.05,
        frictionWeight: 0.8,
        exampleQuote: "Do you ship to Canada and are duties included?",
      },
      {
        groupId: "return",
        label: "Returns & Refunds",
        count: 12,
        uniqueMessages: 10,
        keywords: [
          { keyword: "return", count: 7 },
          { keyword: "refund", count: 5 },
        ],
        trend7: 0.05,
        trend30: -0.02,
        frictionWeight: 0.75,
        exampleQuote: "What is the return policy for sale items?",
      },
      {
        groupId: "payment",
        label: "Payment Options",
        count: 8,
        uniqueMessages: 7,
        keywords: [
          { keyword: "payment", count: 5 },
          { keyword: "paypal", count: 3 },
        ],
        trend7: 0.0,
        trend30: 0.0,
        frictionWeight: 0.7,
        exampleQuote: "Can I pay with PayPal or Klarna?",
      },
    ],
    questionOpportunities: [
      {
        groupId: "shipping",
        label: "Shipping & Delivery Questions",
        count: 14,
        trend7: 0.15,
        severity: "high",
        revenueImpact: 420,
        lowEstimate: 280,
        highEstimate: 560,
        priorityScore: 85,
        actionType: "faq",
        suggestedAction: "Create an FAQ answering shipping destinations, timelines, and costs.",
        exampleQuote: "Do you ship to Canada and are duties included?",
      },
      {
        groupId: "return",
        label: "Return Policy Questions",
        count: 12,
        trend7: 0.05,
        severity: "high",
        revenueImpact: 360,
        lowEstimate: 240,
        highEstimate: 480,
        priorityScore: 80,
        actionType: "faq",
        suggestedAction: "Create a clear returns FAQ with the return window and process.",
        exampleQuote: "Can I return the hoodie because it is too small?",
      },
      {
        groupId: "payment",
        label: "Payment Method Questions",
        count: 8,
        trend7: 0.0,
        severity: "medium",
        revenueImpact: 240,
        lowEstimate: 160,
        highEstimate: 320,
        priorityScore: 65,
        actionType: "faq",
        suggestedAction: "List all accepted payment methods on your FAQ page.",
        exampleQuote: "Can I pay with PayPal or Klarna at checkout?",
      },
    ],
    storewideOpportunities: [
      {
        code: "STOREWIDE_SHIPPING_GAP",
        groupId: "shipping",
        label: "Shipping Policy Gap",
        mentionCount: 14,
        priorityScore: 85,
        severity: "high",
        lowEstimate: 280,
        highEstimate: 560,
        suggestedAction: "Publish a Shipping FAQ page",
        exampleQuote: "Do you ship to Canada?",
      },
      {
        code: "STOREWIDE_RETURN_GAP",
        groupId: "return",
        label: "Return Policy Gap",
        mentionCount: 12,
        priorityScore: 80,
        severity: "high",
        lowEstimate: 240,
        highEstimate: 480,
        suggestedAction: "Publish a Returns FAQ page",
        exampleQuote: "What is the return window?",
      },
    ],
    productConfusion: [
      {
        productId: "sample-1",
        productTitle: "Everyday Matcha Starter Kit",
        mentionCount: 6,
        confusionScore: 72,
        topGroups: ["ingredient", "certificate", "shipping"],
        exampleQuote: "Is the matcha certified organic?",
      },
      {
        productId: "sample-2",
        productTitle: "CloudFit Travel Hoodie",
        mentionCount: 5,
        confusionScore: 65,
        topGroups: ["size", "return", "stock"],
        exampleQuote: "Does the hoodie fit true to size?",
      },
      {
        productId: "sample-3",
        productTitle: "PureGlow Vitamin C Serum",
        mentionCount: 4,
        confusionScore: 58,
        topGroups: ["ingredient", "usage", "compare"],
        exampleQuote: "Is the serum vegan and gluten free?",
      },
    ],
    faqOpportunities: [
      {
        groupId: "shipping",
        question: "What are your shipping options and delivery times?",
        rationale: "14 customers asked about shipping",
        frequency: 14,
        hasContent: false,
        priority: 85,
      },
      {
        groupId: "return",
        question: "What is your return policy?",
        rationale: "12 customers asked about returns",
        frequency: 12,
        hasContent: false,
        priority: 80,
      },
      {
        groupId: "payment",
        question: "What payment methods do you accept?",
        rationale: "8 customers asked about payment",
        frequency: 8,
        hasContent: false,
        priority: 65,
      },
    ],
    competitors: [
      { name: "Amazon", count: 3, exampleQuote: "Amazon has a similar matcha kit cheaper" },
      { name: "Temu", count: 2, exampleQuote: "I found it cheaper on Temu, is yours genuine?" },
    ],
    revenueLeakage: [
      {
        groupId: "shipping",
        label: "Shipping questions",
        severity: "high",
        count: 14,
        trend7: 0.15,
        message: "Shipping questions are rising — add a FAQ page to address delivery concerns.",
      },
      {
        groupId: "return",
        label: "Return questions",
        severity: "high",
        count: 12,
        trend7: 0.05,
        message: "Return questions remain high — a clear policy page reduces cart abandonment.",
      },
    ],
    revenueOpportunity: {
      amount: 1020,
      currency: "USD",
      monthlyAtRisk: 1020,
      estimatedLow: 680,
      estimatedHigh: 1360,
      headline: "$680–$1,360/mo in recoverable revenue",
      summary:
        "45 customer questions signal buying friction. Answering the top 3 topics (Shipping, Returns, Payment) could recover $680–$1,360/mo.",
      topFriction: { label: "Shipping & Delivery", trend7: 0.15, count: 14 },
      quickWins: [
        {
          title: "Publish Shipping FAQ Page",
          action: "publish-page",
          impact: "high",
          lowEstimate: 280,
          highEstimate: 560,
          ctaLabel: "Publish Now",
          groupId: "shipping",
        },
        {
          title: "Create Returns Policy Page",
          action: "publish-page",
          impact: "high",
          lowEstimate: 240,
          highEstimate: 480,
          ctaLabel: "Publish Now",
          groupId: "return",
        },
        {
          title: "Add Payment FAQ",
          action: "faq",
          impact: "medium",
          lowEstimate: 160,
          highEstimate: 320,
          ctaLabel: "Create Answer",
          groupId: "payment",
        },
      ],
      drivers: [
        {
          groupId: "shipping",
          label: "Shipping & Delivery",
          count: 14,
          revenueImpact: 420,
          lowEstimate: 280,
          highEstimate: 560,
          priorityScore: 85,
        },
        {
          groupId: "return",
          label: "Returns & Refunds",
          count: 12,
          revenueImpact: 360,
          lowEstimate: 240,
          highEstimate: 480,
          priorityScore: 80,
        },
      ],
      opportunities: [
        { label: "Shipping Policy Gap", revenueImpact: 420, lowEstimate: 280, highEstimate: 560 },
        { label: "Returns Policy Gap", revenueImpact: 360, lowEstimate: 240, highEstimate: 480 },
      ],
      alerts: [
        {
          groupId: "shipping",
          label: "Shipping questions",
          severity: "high",
          count: 14,
          trend7: 0.15,
          message: "Shipping questions rising 15% week over week.",
        },
      ],
    },
    recommendedActions: [
      {
        id: "ship-faq",
        title: "Answer Shipping Questions",
        priority: "high",
        priorityScore: 85,
        mentions: 14,
        lowEstimate: 280,
        highEstimate: 560,
        recommendedAction:
          "Publish a FAQ page covering shipping destinations, timelines, and costs.",
        ctaLabel: "Publish FAQ",
        targetUrl: "/app/publish",
        groupId: "shipping",
      },
      {
        id: "return-faq",
        title: "Answer Return Questions",
        priority: "high",
        priorityScore: 80,
        mentions: 12,
        lowEstimate: 240,
        highEstimate: 480,
        recommendedAction: "Publish a returns policy page with your return window and process.",
        ctaLabel: "Publish FAQ",
        targetUrl: "/app/publish",
        groupId: "return",
      },
      {
        id: "payment-faq",
        title: "List Payment Options",
        priority: "medium",
        priorityScore: 65,
        mentions: 8,
        lowEstimate: 160,
        highEstimate: 320,
        recommendedAction: "Create an FAQ listing all accepted payment methods.",
        ctaLabel: "Create Answer",
        targetUrl: "/app/faq",
        groupId: "payment",
      },
    ],
    contentGaps: [
      {
        productId: "sample-1",
        productTitle: "Everyday Matcha Starter Kit",
        mentionCount: 6,
        contentGapScore: 72,
        missingSections: ["ingredients", "certifications", "shipping"],
        coveredSections: ["usage"],
        customerQuestions: [
          "Is the matcha certified organic?",
          "Is it imported from Japan?",
        ],
        estimatedLow: 120,
        estimatedHigh: 240,
        recommendedActions: ["Add organic certification info", "List ingredient sourcing"],
        expectedImpact: "medium",
        timeToFix: "30 minutes",
      },
      {
        productId: "sample-2",
        productTitle: "CloudFit Travel Hoodie",
        mentionCount: 5,
        contentGapScore: 65,
        missingSections: ["size_guide", "return_policy", "stock"],
        coveredSections: [],
        customerQuestions: [
          "Does the hoodie fit true to size?",
          "Can I preorder the large?",
        ],
        estimatedLow: 100,
        estimatedHigh: 200,
        recommendedActions: ["Add size guide", "Clarify return policy"],
        expectedImpact: "medium",
        timeToFix: "20 minutes",
      },
    ],
    competitorThreats: [
      {
        name: "Amazon",
        mentionCount: 3,
        threatScore: 60,
        reasons: ["Price comparison", "Availability"],
        recommendation:
          "Highlight your unique value: quality, support, and direct-from-brand trust.",
        exampleQuote: "Amazon has a similar kit cheaper",
      },
    ],
    weeklyTrend: [
      { date: day(6), count: 5 },
      { date: day(5), count: 6 },
      { date: day(4), count: 7 },
      { date: day(3), count: 8 },
      { date: day(2), count: 7 },
      { date: day(1), count: 6 },
      { date: day(0), count: 6 },
    ],
  };
}
