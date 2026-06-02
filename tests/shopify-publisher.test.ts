import { describe, expect, it } from "vitest";

import {
  ALL_PAGE_CONTENT_TYPES,
  DEFAULT_FAQS,
  PAGE_TYPE_GROUPS,
  PAGE_TYPE_LABELS,
  buildArticleContent,
  buildPageContent,
  faqsForPageType,
  type FaqItem,
  type PageContentType,
} from "~/lib/publish";

const SAMPLE_FAQS: FaqItem[] = [
  { question: "How long does shipping take?", answer: "3-5 business days." },
  { question: "Do you offer free shipping?", answer: "On orders over $50." },
];

describe("buildPageContent", () => {
  it("returns a title, handle, and bodyHtml for every page content type", () => {
    for (const type of ALL_PAGE_CONTENT_TYPES) {
      const { title, handle, bodyHtml } = buildPageContent(type, SAMPLE_FAQS);
      expect(title.length).toBeGreaterThan(0);
      expect(handle.length).toBeGreaterThan(0);
      expect(bodyHtml).toContain("<h1>");
      expect(bodyHtml).toContain("<details");
      expect(bodyHtml).toContain("How long does shipping take?");
    }
  });

  it("includes FAQ schema JSON-LD when items are provided", () => {
    const { bodyHtml } = buildPageContent("shipping_page", SAMPLE_FAQS);
    expect(bodyHtml).toContain("application/ld+json");
    expect(bodyHtml).toContain("FAQPage");
    expect(bodyHtml).toContain("How long does shipping take?");
  });

  it("omits FAQ schema when item list is empty", () => {
    const { bodyHtml } = buildPageContent("faq_page", []);
    expect(bodyHtml).not.toContain("application/ld+json");
  });

  it("escapes HTML special characters in questions and answers", () => {
    const xss: FaqItem[] = [
      { question: "Is <b>bold</b> allowed?", answer: 'Use "quotes" & ampersands.' },
    ];
    const { bodyHtml } = buildPageContent("faq_page", xss);
    expect(bodyHtml).not.toContain("<b>bold</b>");
    expect(bodyHtml).toContain("&lt;b&gt;bold&lt;/b&gt;");
    expect(bodyHtml).toContain("&amp;");
    expect(bodyHtml).toContain("&quot;");
  });

  it("generates unique handles for every page type", () => {
    const handles = ALL_PAGE_CONTENT_TYPES.map((t) => buildPageContent(t, []).handle);
    const unique = new Set(handles);
    expect(unique.size).toBe(ALL_PAGE_CONTENT_TYPES.length);
  });
});

describe("buildArticleContent", () => {
  it("returns title, handle, bodyHtml, and summary", () => {
    const article = buildArticleContent("shipping", SAMPLE_FAQS, "My Store");
    expect(article.title).toContain("Shipping");
    expect(article.handle).toContain("shipping");
    expect(article.summary.length).toBeGreaterThan(0);
    expect(article.bodyHtml).toContain("My Store");
    expect(article.bodyHtml).toContain("How long does shipping take?");
  });

  it("includes CTA link at the bottom", () => {
    const article = buildArticleContent("return", SAMPLE_FAQS);
    expect(article.bodyHtml).toContain('<a href="/">');
  });

  it("includes FAQ schema when items provided", () => {
    const article = buildArticleContent("payment", SAMPLE_FAQS);
    expect(article.bodyHtml).toContain("FAQPage");
  });

  it("uses fallback label for unknown groupId", () => {
    const article = buildArticleContent("unknown_group", SAMPLE_FAQS);
    expect(article.title.length).toBeGreaterThan(0);
  });
});

describe("faqsForPageType", () => {
  it("returns provided insight FAQs when available", () => {
    const result = faqsForPageType("shipping_page", SAMPLE_FAQS);
    expect(result).toEqual(SAMPLE_FAQS);
  });

  it("falls back to DEFAULT_FAQS when no insight FAQs provided", () => {
    const result = faqsForPageType("return_page", []);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty("question");
    expect(result[0]).toHaveProperty("answer");
  });

  it("limits result to 8 items maximum", () => {
    const many: FaqItem[] = Array.from({ length: 20 }, (_, i) => ({
      question: `Question ${i}`,
      answer: `Answer ${i}`,
    }));
    const result = faqsForPageType("faq_page", many);
    expect(result.length).toBeLessThanOrEqual(8);
  });
});

describe("DEFAULT_FAQS", () => {
  it("has entries for the primary friction groups", () => {
    const groups = ["shipping", "return", "payment", "refund", "stock", "size"];
    for (const group of groups) {
      expect(DEFAULT_FAQS[group]).toBeDefined();
      expect(DEFAULT_FAQS[group]!.length).toBeGreaterThan(0);
    }
  });

  it("every default FAQ has non-empty question and answer", () => {
    for (const items of Object.values(DEFAULT_FAQS)) {
      for (const item of items) {
        expect(item.question.trim().length).toBeGreaterThan(0);
        expect(item.answer.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("PAGE_TYPE_GROUPS", () => {
  it("every page type maps to at least one group", () => {
    for (const type of ALL_PAGE_CONTENT_TYPES) {
      expect(PAGE_TYPE_GROUPS[type].length).toBeGreaterThan(0);
    }
  });
});

describe("PAGE_TYPE_LABELS", () => {
  it("every page type has a human-readable label", () => {
    for (const type of ALL_PAGE_CONTENT_TYPES) {
      expect(PAGE_TYPE_LABELS[type].length).toBeGreaterThan(0);
    }
  });
});
