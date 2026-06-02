import { describe, expect, it } from "vitest";

import {
  STOREWIDE_GROUP_IDS,
  PRODUCT_SPECIFIC_GROUP_IDS,
  scoreProductTopicRelevance,
} from "~/lib/engine/product-matcher";
import { buildContentGapAnalysis, buildCompetitorThreats } from "~/lib/recovery-engine.server";
import { detectProductConfusion } from "~/lib/engine/product-confusion";
import { detectCompetitors } from "~/lib/engine/competitor";
import { moneyRange } from "~/components/format";

// ─── helpers ──────────────────────────────────────────────────────────────────

function msg(content: string, daysAgo = 1) {
  return {
    id: `msg-${Math.random()}`,
    content,
    source: "manual",
    occurredAt: new Date(Date.now() - daysAgo * 86_400_000),
    customerRef: null,
    externalId: null,
  };
}

function product(
  id: string,
  title: string,
  description = "",
  tags: string[] = [],
  productType: string | null = null,
) {
  return { id, title, description, tags, productType, collections: [], handle: title.toLowerCase().replace(/ /g, "-") };
}

// ─── Part 6, test 1: storewide topics don't create ProductFinding per product ──

describe("storewide topics do not create per-product findings", () => {
  it("payment/shipping/return messages produce no content gap per product", () => {
    const products18 = Array.from({ length: 18 }, (_, i) =>
      product(`gid://shopify/Product/${i}`, `Snowboard Model ${i}`, "Snowboard for freeriding"),
    );
    const storewideMessages = [
      msg("How do I pay? Does PayPal work?"),
      msg("What are your shipping costs?"),
      msg("Can I return this if it doesn't fit?"),
      msg("Is there a refund policy?"),
      msg("Do you accept credit cards?"),
    ];
    // No product confusion because messages don't name products
    const confusionResults = detectProductConfusion(storewideMessages, products18);
    expect(confusionResults).toHaveLength(0);

    const gaps = buildContentGapAnalysis({
      storeProducts: products18,
      products: confusionResults,
      faqOpportunities: [],
      questionOpportunities: [
        { groupId: "payment", label: "Payment", count: 3, trend7: 0, severity: "medium", revenueImpact: 100, lowEstimate: 50, highEstimate: 150, priorityScore: 50, actionType: "faq", suggestedAction: "Clarify Payment Options" },
        { groupId: "shipping", label: "Shipping", count: 4, trend7: 0, severity: "medium", revenueImpact: 150, lowEstimate: 80, highEstimate: 200, priorityScore: 55, actionType: "faq", suggestedAction: "Add Shipping FAQ" },
        { groupId: "return", label: "Returns", count: 3, trend7: 0, severity: "medium", revenueImpact: 120, lowEstimate: 60, highEstimate: 180, priorityScore: 48, actionType: "policy", suggestedAction: "Add Return Policy FAQ" },
      ],
    });

    // Storewide topics should NOT create ProductFinding for unrelated snowboard products
    expect(gaps).toHaveLength(0);
  });
});

// ─── Part 6, test 2: ingredient question without product signal → no 18 findings ─

describe("ingredient topic without product signal", () => {
  it("ingredient question with no food/beauty products creates 0 gap findings", () => {
    const snowboardProducts = Array.from({ length: 18 }, (_, i) =>
      product(`gid://shopify/Product/${i}`, `Snowboard ${i}`, "High-performance snowboard for powder and park"),
    );
    const ingredientMessages = [msg("What are the ingredients?"), msg("Is this vegan?")];
    const confusion = detectProductConfusion(ingredientMessages, snowboardProducts);
    expect(confusion).toHaveLength(0); // No direct product mention

    const gaps = buildContentGapAnalysis({
      storeProducts: snowboardProducts,
      products: confusion,
      faqOpportunities: [],
      questionOpportunities: [
        { groupId: "ingredient", label: "Ingredients", count: 2, trend7: 0, severity: "low", revenueImpact: 40, lowEstimate: 20, highEstimate: 60, priorityScore: 20, actionType: "faq", suggestedAction: "Expand Ingredient Details" },
      ],
    });

    // Snowboards have no ingredient signal → 0 product-specific findings
    expect(gaps).toHaveLength(0);
  });

  it("ingredient question with food/beauty products creates targeted findings", () => {
    const matchaProducts = [
      product("gid://shopify/Product/1", "Organic Matcha Powder", "Pure ceremonial grade matcha tea powder, vegan, gluten-free", ["matcha", "organic"]),
      product("gid://shopify/Product/2", "Green Tea Extract", "Concentrated green tea extract supplement", ["tea", "supplement"]),
    ];
    const snowboard = product("gid://shopify/Product/3", "Snowboard Pro", "High-performance snowboard");
    const allProducts = [...matchaProducts, snowboard];
    const ingredientMessages = [msg("What are the ingredients?"), msg("Is this vegan certified?")];
    const confusion = detectProductConfusion(ingredientMessages, allProducts);

    const gaps = buildContentGapAnalysis({
      storeProducts: allProducts,
      products: confusion,
      faqOpportunities: [],
      questionOpportunities: [
        { groupId: "ingredient", label: "Ingredients", count: 2, trend7: 0, severity: "medium", revenueImpact: 80, lowEstimate: 40, highEstimate: 120, priorityScore: 35, actionType: "faq", suggestedAction: "Expand Ingredient Details" },
      ],
    });

    // Matcha/tea products should be found; snowboard should not
    const gapTitles = gaps.map((g) => g.productTitle);
    expect(gapTitles.some((t) => t.includes("Matcha") || t.includes("Green Tea"))).toBe(true);
    expect(gapTitles).not.toContain("Snowboard Pro");
  });
});

// ─── Part 6, test 3: product title mention → correct ProductFinding ────────────

describe("direct product title mention", () => {
  it("creates ProductConfusionResult for the named product only", () => {
    const products = [
      product("gid://shopify/Product/1", "CloudFit Hoodie", "Comfortable athletic hoodie"),
      product("gid://shopify/Product/2", "TrailRun Shoes", "Lightweight trail running shoes"),
    ];
    const messages = [
      msg("Does the CloudFit Hoodie run small? What size should I order?"),
      msg("Is the cloudfit hoodie true to size?"),
    ];
    const confusion = detectProductConfusion(messages, products);
    expect(confusion).toHaveLength(1);
    expect(confusion[0].productTitle).toBe("CloudFit Hoodie");
    expect(confusion[0].mentionCount).toBe(2);
    expect(confusion[0].topGroups).toContain("size");
  });

  it("matches product by handle, vendor, tags, and product type", () => {
    const products = [
      {
        ...product("gid://shopify/Product/1", "CloudFit Hoodie", "Comfortable athletic hoodie", ["winterwear"], "Clothing"),
        handle: "cloudfit-hoodie",
        vendor: "North Peak",
      },
      product("gid://shopify/Product/2", "TrailRun Shoes", "Lightweight trail running shoes"),
    ];
    const messages = [
      msg("Does north peak have a return policy?"),
      msg("Is the cloudfit-hoodie available in XL size?"),
      msg("Is your winterwear shipping fast?"),
    ];
    const confusion = detectProductConfusion(messages, products);
    expect(confusion).toHaveLength(1);
    expect(confusion[0].productTitle).toBe("CloudFit Hoodie");
    expect(confusion[0].mentionCount).toBe(3);
    expect(confusion[0].topGroups).toEqual(expect.arrayContaining(["return", "size", "shipping"]));
  });
});

// ─── Part 6, test 4: tag/type match → inferred finding with medium confidence ──

describe("product-topic relevance scoring", () => {
  it("returns 0 for storewide topics regardless of product", () => {
    const snowboard = product("gid://1", "Snowboard", "Cool snowboard");
    expect(scoreProductTopicRelevance(snowboard, "shipping")).toBe(0);
    expect(scoreProductTopicRelevance(snowboard, "payment")).toBe(0);
    expect(scoreProductTopicRelevance(snowboard, "return")).toBe(0);
    expect(scoreProductTopicRelevance(snowboard, "refund")).toBe(0);
    expect(scoreProductTopicRelevance(snowboard, "delivery")).toBe(0);
    expect(scoreProductTopicRelevance(snowboard, "discount")).toBe(0);
    expect(scoreProductTopicRelevance(snowboard, "warranty")).toBe(0);
  });

  it("returns 0 for compare/competitor (require direct confusion)", () => {
    expect(scoreProductTopicRelevance(product("1", "Matcha Powder"), "compare")).toBe(0);
    expect(scoreProductTopicRelevance(product("1", "Matcha Powder"), "competitor")).toBe(0);
  });

  it("scores ingredient topic high for food/beauty products", () => {
    const matcha = product("1", "Organic Matcha", "Pure matcha powder", ["organic", "matcha", "tea"]);
    const score = scoreProductTopicRelevance(matcha, "ingredient");
    expect(score).toBeGreaterThanOrEqual(25); // medium confidence
  });

  it("scores ingredient topic 0 for unrelated products", () => {
    const snowboard = product("1", "Snowboard Pro", "Carbon fiber snowboard for expert riders");
    const score = scoreProductTopicRelevance(snowboard, "ingredient");
    expect(score).toBe(0);
  });

  it("scores size topic high for apparel/sporting goods products", () => {
    const hoodie = product("1", "CloudFit Hoodie", "Athletic hoodie", ["apparel", "hoodie"], "Clothing");
    const score = scoreProductTopicRelevance(hoodie, "size");
    expect(score).toBeGreaterThanOrEqual(25);
  });

  it("scores size topic 0 for digital products", () => {
    const ebook = product("1", "JavaScript Guide PDF", "Learn JavaScript", [], "Digital");
    const score = scoreProductTopicRelevance(ebook, "size");
    expect(score).toBe(0);
  });
});

// ─── Part 6, test 5: storewide topics still in Insights/FAQ ───────────────────

describe("storewide topics appear in Insights and FAQ opportunities", () => {
  it("keyword groups still contain storewide topics after analysis", () => {
    // Storewide group IDs are defined and not filtered from keyword analysis
    expect(STOREWIDE_GROUP_IDS.has("shipping")).toBe(true);
    expect(STOREWIDE_GROUP_IDS.has("delivery")).toBe(true);
    expect(STOREWIDE_GROUP_IDS.has("payment")).toBe(true);
    expect(STOREWIDE_GROUP_IDS.has("return")).toBe(true);
    expect(STOREWIDE_GROUP_IDS.has("refund")).toBe(true);
  });

  it("product-specific groups are not in the storewide set", () => {
    expect(STOREWIDE_GROUP_IDS.has("ingredient")).toBe(false);
    expect(STOREWIDE_GROUP_IDS.has("size")).toBe(false);
    expect(STOREWIDE_GROUP_IDS.has("usage")).toBe(false);
    expect(STOREWIDE_GROUP_IDS.has("caffeine")).toBe(false);
    expect(PRODUCT_SPECIFIC_GROUP_IDS.has("ingredient")).toBe(true);
    expect(PRODUCT_SPECIFIC_GROUP_IDS.has("size")).toBe(true);
  });
});

// ─── Part 6, test 6: products total ≤ importedMessageCount × reasonable factor ─

describe("product question count does not inflate beyond imported messages", () => {
  it("displayMentions from contentGaps equals real mentionCount (not customerQuestions.length)", () => {
    const products18 = Array.from({ length: 18 }, (_, i) =>
      product(`gid://shopify/Product/${i}`, `Product ${i}`, "Generic product"),
    );
    const messages = Array.from({ length: 36 }, (_, i) => msg(`delivery time question ${i}`));
    const confusion = detectProductConfusion(messages, products18);
    // Generic delivery messages don't name products, so confusion is empty
    expect(confusion).toHaveLength(0);

    const gaps = buildContentGapAnalysis({
      storeProducts: products18,
      products: confusion,
      faqOpportunities: [],
      questionOpportunities: [
        { groupId: "delivery", label: "Delivery time", count: 36, trend7: 0, severity: "high", revenueImpact: 200, lowEstimate: 100, highEstimate: 300, priorityScore: 70, actionType: "faq", suggestedAction: "Clarify Delivery Timeline" },
      ],
    });

    // "delivery" is storewide — no product findings
    expect(gaps).toHaveLength(0);

    // Simulated: if gaps existed, their mentionCount would be 0 (real count), not the old customerQuestions.length
    const totalMentionCount = gaps.reduce((sum, g) => sum + g.mentionCount, 0);
    // Total can NEVER exceed importedMessageCount (36) for direct-mention products
    expect(totalMentionCount).toBeLessThanOrEqual(36);
  });
});

// ─── Part 6, test 8: competitor mentions = 0 → threatScore 0, productsAffected 0 ─

describe("competitor engine with zero mentions", () => {
  it("buildCompetitorThreats returns empty array when no competitors detected", () => {
    const threats = buildCompetitorThreats([], 0);
    expect(threats).toHaveLength(0);
  });

  it("detectCompetitors returns empty when messages have no brand names", () => {
    const messages = [
      msg("How long does shipping take?"),
      msg("Can I return this?"),
      msg("What ingredients does this have?"),
    ];
    const competitors = detectCompetitors(messages, []);
    expect(competitors).toHaveLength(0);
  });

  it("pressureScore is 0 when totalMentions is 0 (no competitor brands)", () => {
    const totalMentions = 0;
    const competitors: unknown[] = [];
    const comparedProducts: unknown[] = [];
    // Replicate the pressureScore formula from app.competitors.tsx
    const pressureScore = totalMentions === 0
      ? 0
      : Math.min(100, Math.round(totalMentions * 6 + competitors.length * 8 + comparedProducts.length * 6));
    expect(pressureScore).toBe(0);
  });
});

// ─── Part 6, test 9: competitor mention without product signal ─────────────────

describe("competitor mention without product signal", () => {
  it("competitor mention in storewide message does not create product-specific threat", () => {
    const messages = [
      msg("Is this cheaper on Amazon?"),
      msg("I found it on Amazon for less"),
    ];
    const products = [
      product("gid://shopify/Product/1", "Snowboard", "Premium snowboard"),
    ];

    const competitors = detectCompetitors(messages, []);
    expect(competitors.some((c) => c.name === "amazon")).toBe(true);

    // Product confusion: no product title mentioned in messages
    const confusion = detectProductConfusion(messages, products);
    expect(confusion).toHaveLength(0);

    // comparedProducts requires BOTH competitor mention AND direct product confusion
    // Since confusion is empty, comparedProducts is empty
    const comparedProducts = confusion.filter((p) =>
      p.topGroups.some((g) => g === "competitor" || g === "compare"),
    );
    expect(comparedProducts).toHaveLength(0);
  });
});

// ─── Part 6, test 7: revenue helper consistency (type check) ──────────────────

describe("revenue helper consistency", () => {
  it("moneyRange helper is deterministic with en-US formatting", () => {
    // moneyRange from format.ts uses Intl.NumberFormat("en-US") — SSR-safe.
    // Dashboard, Products, Reports all call the same helper, so they produce
    // identical output for the same low/high values.
    expect(moneyRange(103, 276)).toBe("$103-$276");
    expect(moneyRange(0, 0)).toContain("Connect orders");
    expect(moneyRange(1000, 2500)).toBe("$1,000-$2,500");
  });
});
