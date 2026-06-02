// Performance benchmark: analysis engine (keyword extraction + scoring).
// Target: 500 messages processed in < 1000 ms on CI hardware.

import { describe, expect, it } from "vitest";
import { buildKeywordGroupResults } from "~/lib/engine/keyword-engine";
import { runAnalysis } from "~/lib/engine";
import { buildSampleAnalysisInput } from "~/lib/sample-data";
import type { NormalizedMessage } from "~/lib/types";

const BASE_DATE = new Date("2026-06-01T00:00:00Z");

function makeMessages(count: number): NormalizedMessage[] {
  const TEMPLATES = [
    "How long does shipping take to {country}?",
    "Can I return the product if it doesn't fit?",
    "Do you offer a discount code for first-time buyers?",
    "What payment methods do you accept at checkout?",
    "Is this product vegan and gluten free?",
    "When will the item be back in stock?",
    "My order has not arrived after 14 days, what do I do?",
    "Can I get a refund if I changed my mind?",
    "How does this compare to the competitor brand?",
    "Is there a warranty if the zipper breaks?",
  ];
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${i}`,
    content: TEMPLATES[i % TEMPLATES.length].replace("{country}", i % 2 === 0 ? "Canada" : "Australia"),
    source: "email",
    occurredAt: new Date(BASE_DATE.getTime() - (i % 30) * 86_400_000),
  }));
}

describe("Analysis Engine — performance benchmarks", () => {
  it("buildKeywordGroupResults: 200 messages < 200ms", () => {
    const messages = makeMessages(200);
    const start = performance.now();
    const result = buildKeywordGroupResults(messages, BASE_DATE, 30);
    const elapsed = performance.now() - start;
    expect(result.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(200);
  });

  it("buildKeywordGroupResults: 500 messages < 800ms", () => {
    const messages = makeMessages(500);
    const start = performance.now();
    buildKeywordGroupResults(messages, BASE_DATE, 30);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(800);
  });

  it("runAnalysis: standard sample input < 500ms", () => {
    const input = buildSampleAnalysisInput(BASE_DATE);
    const start = performance.now();
    const result = runAnalysis(input);
    const elapsed = performance.now() - start;
    expect(result.insightScore).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(500);
  });

  it("runAnalysis: 100-message input < 800ms", () => {
    const input = {
      ...buildSampleAnalysisInput(BASE_DATE),
      messages: makeMessages(100),
      now: BASE_DATE,
    };
    const start = performance.now();
    const result = runAnalysis(input);
    const elapsed = performance.now() - start;
    expect(result.messageCount).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(800);
  });

  it("10 consecutive runs complete under 5 seconds total", () => {
    const input = buildSampleAnalysisInput(BASE_DATE);
    const start = performance.now();
    for (let i = 0; i < 10; i++) runAnalysis(input);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5000);
  });
});
