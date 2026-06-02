import type {
  KeywordGroupId,
  NormalizedMessage,
  ProductConfusionResult,
  ProductInput,
} from "~/lib/types";

import { KEYWORD_GROUPS_BY_ID } from "./keyword-groups";
import { extractHits } from "./keyword-engine";
import { normalizeText, splitSentences } from "./normalize";
import { STOP_WORDS } from "./stopwords";
import { tokenize } from "./tokenize";

function productTokens(product: ProductInput): string[] {
  const terms = tokenize(product.title, { removeStopWords: true, minLength: 4 });
  const fullTitle = normalizeText(product.title);
  if (fullTitle.length >= 4) terms.push(fullTitle);
  if (product.handle) terms.push(normalizeText(product.handle));
  if (product.vendor) {
    terms.push(normalizeText(product.vendor));
    terms.push(...tokenize(product.vendor, { removeStopWords: true, minLength: 4 }));
  }
  if (product.productType) terms.push(...tokenize(product.productType, { removeStopWords: true, minLength: 4 }));
  for (const tag of product.tags ?? []) terms.push(...tokenize(tag, { removeStopWords: true, minLength: 4 }));
  return [...new Set(terms.filter((term) => !STOP_WORDS.has(term)))];
}

export function messageMatchesProduct(message: NormalizedMessage, product: ProductInput): boolean {
  const normalized = normalizeText(message.content);
  return productTokens(product).some((term) => normalized.includes(term));
}

export function detectProductConfusion(
  messages: NormalizedMessage[],
  products: ProductInput[],
  limit = 10,
): ProductConfusionResult[] {
  const results: ProductConfusionResult[] = [];

  for (const product of products) {
    const terms = productTokens(product);
    if (terms.length === 0) continue;

    let mentionCount = 0;
    let friction = 0;
    let exampleQuote: string | undefined;
    const groups = new Map<KeywordGroupId, number>();

    for (const message of messages) {
      const normalized = normalizeText(message.content);
      if (!terms.some((term) => normalized.includes(term))) continue;
      mentionCount += 1;
      exampleQuote ??= splitSentences(message.content)[0] ?? message.content;

      for (const hit of extractHits(message)) {
        const weight = KEYWORD_GROUPS_BY_ID[hit.groupId].frictionWeight;
        friction += weight;
        groups.set(hit.groupId, (groups.get(hit.groupId) ?? 0) + 1);
      }
    }

    if (mentionCount > 0) {
      const topGroups = [...groups.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([groupId]) => groupId);
      results.push({
        productId: product.id,
        productTitle: product.title,
        mentionCount,
        confusionScore: Math.min(100, Math.round(mentionCount * 10 + friction * 12)),
        topGroups,
        exampleQuote,
      });
    }
  }

  return results
    .sort((a, b) => b.confusionScore - a.confusionScore || b.mentionCount - a.mentionCount)
    .slice(0, limit);
}
