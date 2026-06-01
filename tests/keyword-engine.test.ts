import { describe, expect, it } from "vitest";

import { buildKeywordGroupResults, extractHits } from "~/lib/engine";
import type { NormalizedMessage } from "~/lib/types";

const now = new Date("2026-06-01T00:00:00Z");

function message(content: string, daysAgo = 0): NormalizedMessage {
  return {
    id: content,
    content,
    occurredAt: new Date(now.getTime() - daysAgo * 86_400_000),
    source: "test",
  };
}

describe("keyword engine", () => {
  it("extracts keyword hits", () => {
    const hits = extractHits(message("Shipping cost is high and delivery is late"));
    expect(hits.map((hit) => hit.groupId)).toContain("shipping");
    expect(hits.map((hit) => hit.groupId)).toContain("delivery");
  });

  it("builds sorted group results by impact", () => {
    const results = buildKeywordGroupResults(
      [
        message("I need a refund"),
        message("Refund my order"),
        message("Shipping cost is high"),
      ],
      now,
    );
    expect(results[0]?.groupId).toBe("refund");
    expect(results[0]?.count).toBeGreaterThan(1);
  });

  it("does not crash with empty, Vietnamese, or emoji text", () => {
    const inputs = [
      message(""),
      message("Tôi muốn hỏi phí shipping về Việt Nam có cao không? 😊"),
      message("🔥🔥🔥"),
    ];
    expect(() => inputs.flatMap((input) => extractHits(input))).not.toThrow();
    expect(() => buildKeywordGroupResults(inputs, now)).not.toThrow();
  });
});
