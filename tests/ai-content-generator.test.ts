import { describe, expect, it } from "vitest";

import {
  buildRuleBasedContent,
  parseAIContentResponse,
  buildContentPrompt,
} from "~/lib/ai/content-generator";
import type { ContentGenerationInput } from "~/lib/ai/types";
import { CONTENT_TYPE_LABELS } from "~/lib/ai/types";

const BASE_INPUT: ContentGenerationInput = {
  contentType: "faq",
  shopDomain: "test-store.myshopify.com",
  storeName: "Test Store",
};

describe("buildRuleBasedContent", () => {
  it("returns all required fields", () => {
    const result = buildRuleBasedContent(BASE_INPUT);
    expect(result.title).toBeTruthy();
    expect(result.slug).toBeTruthy();
    expect(result.seoTitle.length).toBeLessThanOrEqual(60);
    expect(result.metaDescription.length).toBeLessThanOrEqual(160);
    expect(result.html).toContain("<h1>");
    expect(result.plainText).toBeDefined();
    expect(result.source).toBe("rule");
  });

  it("generates content for every content type without throwing", () => {
    const types = Object.keys(CONTENT_TYPE_LABELS) as Array<keyof typeof CONTENT_TYPE_LABELS>;
    for (const contentType of types) {
      const result = buildRuleBasedContent({ ...BASE_INPUT, contentType });
      expect(result.title.length).toBeGreaterThan(0);
      expect(result.html.length).toBeGreaterThan(0);
    }
  });

  it("includes competitor name in competitor_comparison content", () => {
    const result = buildRuleBasedContent({
      ...BASE_INPUT,
      contentType: "competitor_comparison",
      competitorName: "BrandX",
    });
    expect(result.html).toContain("BrandX");
    expect(result.title).toBeTruthy();
  });

  it("uses provided faqs when supplied", () => {
    const result = buildRuleBasedContent({
      ...BASE_INPUT,
      contentType: "shipping_faq",
      faqs: [{ question: "How fast?", answer: "1-2 days." }],
    });
    expect(result.html).toContain("How fast?");
    expect(result.html).toContain("1-2 days.");
  });

  it("generates FAQ schema JSON-LD when faqs are provided", () => {
    const result = buildRuleBasedContent({
      ...BASE_INPUT,
      contentType: "return_faq",
      faqs: [{ question: "Q?", answer: "A." }],
    });
    expect(result.faqSchema).toContain("FAQPage");
    expect(result.jsonLd).toContain("FAQPage");
  });

  it("escapes HTML in questions and answers", () => {
    const result = buildRuleBasedContent({
      ...BASE_INPUT,
      contentType: "faq",
      faqs: [{ question: "<script>xss</script>", answer: "<b>bold</b>" }],
    });
    expect(result.html).not.toContain("<script>xss</script>");
    expect(result.html).toContain("&lt;script&gt;");
  });

  it("produces a URL-safe slug", () => {
    const result = buildRuleBasedContent({ ...BASE_INPUT, contentType: "buying_guide" });
    expect(result.slug).toMatch(/^[a-z0-9-]+$/);
  });

  it("buying_guide includes checklist items", () => {
    const result = buildRuleBasedContent({ ...BASE_INPUT, contentType: "buying_guide" });
    expect(result.html).toContain("<li>");
  });
});

describe("parseAIContentResponse", () => {
  it("parses valid JSON response", () => {
    const raw = JSON.stringify({
      title: "Shipping FAQ",
      slug: "shipping-faq",
      seoTitle: "Shipping FAQ — Test Store",
      metaDescription: "All shipping questions answered.",
      html: "<h1>Shipping FAQ</h1>",
      plainText: "Shipping questions answered.",
      faqItems: [{ question: "How long?", answer: "3-5 days." }],
    });
    const result = parseAIContentResponse(raw, BASE_INPUT);
    expect(result).not.toBeNull();
    expect(result?.title).toBe("Shipping FAQ");
    expect(result?.source).toBe("ai");
    expect(result?.faqSchema).toContain("FAQPage");
  });

  it("extracts JSON from text with surrounding prose", () => {
    const raw = `Here is the content:\n${JSON.stringify({
      title: "FAQ",
      slug: "faq",
      seoTitle: "FAQ",
      metaDescription: "FAQ answers.",
      html: "<h1>FAQ</h1>",
      plainText: "FAQ",
      faqItems: [],
    })}`;
    const result = parseAIContentResponse(raw, BASE_INPUT);
    expect(result).not.toBeNull();
    expect(result?.title).toBe("FAQ");
  });

  it("returns null for invalid JSON", () => {
    const result = parseAIContentResponse("not json at all", BASE_INPUT);
    expect(result).toBeNull();
  });

  it("returns null when title is missing", () => {
    const raw = JSON.stringify({ slug: "x", html: "<p>hi</p>", seoTitle: "x", metaDescription: "x", plainText: "x", faqItems: [] });
    const result = parseAIContentResponse(raw, BASE_INPUT);
    expect(result).toBeNull();
  });

  it("clamps seoTitle to 60 characters", () => {
    const longTitle = "A".repeat(80);
    const raw = JSON.stringify({
      title: "FAQ",
      slug: "faq",
      seoTitle: longTitle,
      metaDescription: "Short.",
      html: "<h1>FAQ</h1>",
      plainText: "FAQ",
      faqItems: [],
    });
    const result = parseAIContentResponse(raw, BASE_INPUT);
    expect(result?.seoTitle.length).toBeLessThanOrEqual(60);
  });
});

describe("buildContentPrompt", () => {
  it("returns system and user strings", () => {
    const prompt = buildContentPrompt(BASE_INPUT);
    expect(prompt.system.length).toBeGreaterThan(0);
    expect(prompt.user.length).toBeGreaterThan(0);
  });

  it("includes contentType in the user prompt", () => {
    const prompt = buildContentPrompt({ ...BASE_INPUT, contentType: "shipping_faq" });
    expect(prompt.user).toContain("shipping");
  });

  it("includes competitorName when provided", () => {
    const prompt = buildContentPrompt({ ...BASE_INPUT, contentType: "competitor_comparison", competitorName: "RivalCo" });
    expect(prompt.user).toContain("RivalCo");
  });
});

describe("CONTENT_TYPE_LABELS", () => {
  it("has a label for every content type", () => {
    const types = [
      "faq", "product_faq", "shipping_faq", "payment_faq", "warranty_faq",
      "return_faq", "refund_faq", "discount_faq", "buying_guide", "comparison_guide",
      "product_comparison", "competitor_comparison", "feature_breakdown",
      "product_benefits", "objection_handling", "why_buy_from_us",
    ];
    for (const t of types) {
      expect(CONTENT_TYPE_LABELS[t as keyof typeof CONTENT_TYPE_LABELS]).toBeTruthy();
    }
  });
});
