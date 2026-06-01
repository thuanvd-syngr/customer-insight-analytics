import type {
  KeywordGroupResult,
  KeywordHit,
  NormalizedMessage,
} from "~/lib/types";

import { KEYWORD_GROUPS } from "./keyword-groups";
import { normalizeText, splitSentences } from "./normalize";
import { computeTrend } from "./trend";
import { tokenize } from "./tokenize";

function wordBoundary(term: string): RegExp {
  return new RegExp(`(^|\\s)${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\s)`);
}

function includesTerm(normalized: string, tokens: Set<string>, term: string): boolean {
  const normalizedTerm = normalizeText(term);
  if (!normalizedTerm.includes(" ")) return tokens.has(normalizedTerm);
  return wordBoundary(normalizedTerm).test(normalized);
}

export function extractHits(message: NormalizedMessage): KeywordHit[] {
  const normalized = normalizeText(message.content);
  const tokens = new Set(tokenize(normalized));
  const hits: KeywordHit[] = [];

  for (const group of KEYWORD_GROUPS) {
    const seen = new Set<string>();
    for (const term of group.terms) {
      const keyword = normalizeText(term);
      if (seen.has(keyword)) continue;
      if (includesTerm(normalized, tokens, keyword)) {
        seen.add(keyword);
        hits.push({
          groupId: group.id,
          keyword,
          messageId: message.id,
          occurredAt: message.occurredAt,
        });
      }
    }
  }

  return hits;
}

export function buildKeywordGroupResults(
  messages: NormalizedMessage[],
  now: Date,
  windowDays = 30,
): KeywordGroupResult[] {
  const start = now.getTime() - windowDays * 86_400_000;
  const aggregates = new Map<
    string,
    {
      messageIds: Set<string>;
      keywordCounts: Map<string, number>;
      timestamps: Date[];
      exampleQuote?: string;
    }
  >();

  for (const message of messages) {
    const hits = extractHits(message);
    for (const hit of hits) {
      const aggregate =
        aggregates.get(hit.groupId) ??
        {
          messageIds: new Set<string>(),
          keywordCounts: new Map<string, number>(),
          timestamps: [],
          exampleQuote: undefined,
        };
      aggregate.timestamps.push(hit.occurredAt);
      if (hit.occurredAt.getTime() > start && hit.occurredAt <= now) {
        aggregate.messageIds.add(hit.messageId);
        aggregate.keywordCounts.set(
          hit.keyword,
          (aggregate.keywordCounts.get(hit.keyword) ?? 0) + 1,
        );
        aggregate.exampleQuote ??= splitSentences(message.content)[0] ?? message.content;
      }
      aggregates.set(hit.groupId, aggregate);
    }
  }

  const results: KeywordGroupResult[] = [];

  for (const group of KEYWORD_GROUPS) {
    const aggregate = aggregates.get(group.id);
    if (!aggregate || aggregate.messageIds.size === 0) continue;
    const keywords = [...aggregate.keywordCounts.entries()]
      .map(([keyword, count]) => ({ keyword, count }))
      .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword))
      .slice(0, 5);

    results.push({
      groupId: group.id,
      label: group.label,
      count: [...aggregate.keywordCounts.values()].reduce((sum, count) => sum + count, 0),
      uniqueMessages: aggregate.messageIds.size,
      keywords,
      trend7: computeTrend(aggregate.timestamps, now, 7),
      trend30: computeTrend(aggregate.timestamps, now, 30),
      frictionWeight: group.frictionWeight,
      exampleQuote: aggregate.exampleQuote,
    });
  }

  return results.sort(
    (a, b) =>
      b.count * b.frictionWeight - a.count * a.frictionWeight ||
      b.count - a.count,
  );
}
