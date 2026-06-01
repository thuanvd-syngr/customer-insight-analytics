import type { KeywordGroupId, ProductInput } from "~/lib/types";
import { normalizeText } from "./normalize";
import { tokenize } from "./tokenize";

/**
 * Friction topics that apply store-wide. These belong in Insights/FAQ as
 * storewide issues. They must NOT be assigned as a ProductFinding for every
 * product when there is no direct customer mention of that product.
 *
 * "When will my order arrive?" is a store question, not a product question.
 */
export const STOREWIDE_GROUP_IDS = new Set<KeywordGroupId>([
  "shipping",
  "delivery",
  "payment",
  "return",
  "refund",
  "discount",
  "warranty",
]);

/**
 * Topics that may be product-specific. Only assigned to a product via
 * content-gap analysis when the product attributes provide a relevance signal.
 */
export const PRODUCT_SPECIFIC_GROUP_IDS = new Set<KeywordGroupId>([
  "ingredient",
  "size",
  "stock",
  "usage",
  "caffeine",
  "certificate",
  "origin",
  "compare",
  "competitor",
]);

// Keyword signals per group. Checked against normalized product text to decide
// whether a product is likely relevant to that topic's customer questions.
const GROUP_RELEVANCE_SIGNALS: Partial<Record<KeywordGroupId, string[]>> = {
  ingredient: [
    "ingredient", "material", "formula", "organic", "natural", "vegan",
    "gluten", "serum", "matcha", "tea", "coffee", "extract", "oil", "cream",
    "powder", "supplement", "vitamin", "protein", "food", "drink", "snack",
    "beauty", "skin", "hair", "lotion", "shampoo", "makeup", "cosmetic",
    "edible", "beverage", "spice", "herb", "botanical",
  ],
  size: [
    "size", "fit", "width", "length", "height", "weight", "dimension",
    "apparel", "clothing", "shirt", "pants", "shoe", "boot", "ring",
    "jacket", "hoodie", "dress", "jeans", "snowboard", "ski", "board",
    "glove", "helmet", "vest", "sock", "hat", "cap", "scarf",
  ],
  usage: [
    "instruction", "guide", "apply", "wash", "care", "setup",
    "configure", "install", "assembly", "operate", "manual",
    "tutorial", "recipe", "routine",
  ],
  caffeine: [
    "caffeine", "coffee", "tea", "matcha", "energy", "drink",
    "supplement", "beverage", "espresso", "latte",
  ],
  certificate: [
    "organic", "fda", "certified", "certificate", "iso", "lab",
    "authentic", "genuine", "official", "approved", "tested",
  ],
  // stock/origin: low-confidence universal match (no keyword filter needed)
};

/**
 * Scores how relevant a friction topic is to a product based on its attributes.
 * Returns 0..60.
 *
 * 0     = not applicable (storewide topic, or no relevance signal found)
 * 1–24  = low signal (stock/origin, or single description word)
 * 25–59 = moderate signal (multiple matches, or match in title/tags/type)
 * 60    = strong match (many signals)
 *
 * Threshold guide:
 *   >= 50 → direct (high confidence)
 *   >= 25 → inferred (medium confidence)
 *   < 25  → storewide only (don't create ProductFinding)
 */
export function scoreProductTopicRelevance(
  product: ProductInput,
  groupId: KeywordGroupId,
): number {
  // Storewide topics are never product-specific via content-gap analysis
  if (STOREWIDE_GROUP_IDS.has(groupId)) return 0;

  // compare/competitor only come from direct product confusion (message names the product)
  if (groupId === "compare" || groupId === "competitor") return 0;

  // stock and origin: mildly relevant to any product, but below the direct threshold
  if (groupId === "stock") return 20;
  if (groupId === "origin") return 15;

  const signals = GROUP_RELEVANCE_SIGNALS[groupId];
  if (!signals || signals.length === 0) return 15;

  const productText = normalizeText([
    product.title ?? "",
    product.description ?? "",
    product.tags?.join(" ") ?? "",
    product.productType ?? "",
    product.collections?.join(" ") ?? "",
  ].join(" "));

  const tokens = new Set(
    tokenize(productText, { removeStopWords: false, minLength: 3 }),
  );

  let score = 0;
  for (const signal of signals) {
    const norm = normalizeText(signal);
    const matched = norm.includes(" ")
      ? productText.includes(norm)
      : tokens.has(norm);
    if (matched) {
      // Title/type/tag matches score higher than description-only
      const isProminent =
        normalizeText(product.title ?? "").includes(norm) ||
        normalizeText(product.productType ?? "").includes(norm) ||
        (product.tags ?? []).some((tag) => normalizeText(tag).includes(norm));
      score += isProminent ? 20 : 8;
      if (score >= 60) return 60;
    }
  }
  return score;
}
