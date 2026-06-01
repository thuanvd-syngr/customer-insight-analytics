import { describe, expect, it } from "vitest";

import { faqToMarkdown, generateFaqFromOpportunity } from "~/lib/faq-generator";

describe("FAQ generator", () => {
  it("generates rule-based FAQ content for an insight", () => {
    const faq = generateFaqFromOpportunity({
      groupId: "shipping",
      question: "How long does shipping take?",
      rationale: "Customers ask before buying",
      frequency: 12,
      hasContent: false,
      priority: 80,
    });

    expect(faq.question).toBe("How long does shipping take?");
    expect(faq.answer).toContain("shipping options");
    expect(faq.source).toBe("rule");
    expect(faqToMarkdown(faq)).toContain("## How long does shipping take?");
  });
});
