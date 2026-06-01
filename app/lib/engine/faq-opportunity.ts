import type {
  FaqOpportunityResult,
  KeywordGroupResult,
  PageInput,
  ProductInput,
} from "~/lib/types";

import { KEYWORD_GROUPS_BY_ID } from "./keyword-groups";
import { normalizeText } from "./normalize";

export function detectFaqOpportunities(
  groups: KeywordGroupResult[],
  products: ProductInput[],
  pages: PageInput[],
): FaqOpportunityResult[] {
  const corpus = normalizeText(
    [
      ...products.map((product) => `${product.title} ${product.description ?? ""}`),
      ...pages.map((page) => `${page.title} ${page.body}`),
    ].join("\n"),
  );

  return groups
    .filter((group) => group.count >= 2)
    .map((group) => {
      const definition = KEYWORD_GROUPS_BY_ID[group.groupId];
      const hasContent = definition.terms.some((term) =>
        corpus.includes(normalizeText(term)),
      );
      const priority = Math.max(
        0,
        Math.min(100, Math.round(group.count * group.frictionWeight * (hasContent ? 6 : 18))),
      );
      return {
        groupId: group.groupId,
        question: definition.question,
        rationale: hasContent
          ? "Existing content appears to mention this topic."
          : `${group.label} questions are frequent but not covered in store content.`,
        frequency: group.count,
        hasContent,
        priority,
      } satisfies FaqOpportunityResult;
    })
    .filter((result) => !result.hasContent)
    .sort((a, b) => b.priority - a.priority || b.frequency - a.frequency);
}
