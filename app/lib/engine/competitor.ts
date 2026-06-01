import type { CompetitorMentionResult, NormalizedMessage } from "~/lib/types";

import { DEFAULT_COMPETITOR_TERMS } from "./keyword-groups";
import { normalizeText, splitSentences } from "./normalize";

function boundary(term: string): RegExp {
  return new RegExp(`(^|\\s)${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\s)`);
}

export function detectCompetitors(
  messages: NormalizedMessage[],
  extraTerms: string[] = [],
): CompetitorMentionResult[] {
  const terms = [...new Set([...DEFAULT_COMPETITOR_TERMS, ...extraTerms].map(normalizeText))]
    .filter(Boolean);
  const counts = new Map<string, { count: number; exampleQuote?: string }>();

  for (const message of messages) {
    const normalized = normalizeText(message.content);
    for (const term of terms) {
      if (!boundary(term).test(normalized)) continue;
      const entry = counts.get(term) ?? { count: 0 };
      entry.count += 1;
      entry.exampleQuote ??= splitSentences(message.content)[0] ?? message.content;
      counts.set(term, entry);
    }
  }

  return [...counts.entries()]
    .map(([name, entry]) => ({ name, count: entry.count, exampleQuote: entry.exampleQuote }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
