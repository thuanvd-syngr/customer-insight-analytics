// Performance benchmark: publish engine (content template generation + library ops).
// Target: 100 page builds < 200ms; 1000 library items filtered in < 50ms.

import { describe, expect, it } from "vitest";
import { buildPageContent, faqsForPageType, type FaqItem } from "~/lib/publish/content-templates";
import { filterLibraryItems, sortLibraryItems, type LibraryItem, type ContentLibraryItemType } from "~/lib/content-library";

function makeFaqs(count: number): FaqItem[] {
  return Array.from({ length: count }, (_, i) => ({
    question: `FAQ question number ${i}: How does this work?`,
    answer: `This is the detailed answer for question ${i}. It covers the topic thoroughly and provides actionable steps the customer can take.`,
  }));
}

function makeLibraryItems(count: number): LibraryItem[] {
  const TYPES: ContentLibraryItemType[] = ["faq", "blog_tip", "page_template", "email_snippet", "social_post"];
  const STATUSES = ["active", "archived"] as const;
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    itemType: TYPES[i % TYPES.length],
    title: `Library Item ${i}: Frequently Asked Question about shipping`,
    content: `Content for item ${i}. This discusses shipping, returns, and other customer concerns.`,
    tags: ["shipping", "faq"],
    groupId: i % 3 === 0 ? "shipping" : null,
    productId: null,
    source: "generated" as const,
    status: STATUSES[i % 2],
    usageCount: i % 10,
    createdAt: new Date(Date.now() - i * 86_400_000).toISOString(),
  }));
}

describe("Publish Engine — performance benchmarks", () => {
  it("buildPageContent (faq_page) with 20 FAQs < 10ms", () => {
    const faqs = makeFaqs(20);
    const start = performance.now();
    const page = buildPageContent("faq_page", faqs);
    const elapsed = performance.now() - start;
    expect(page.bodyHtml.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(10);
  });

  it("100 buildPageContent calls < 200ms", () => {
    const faqs = makeFaqs(10);
    const TYPES = ["faq_page", "shipping_page", "return_page", "warranty_page", "payment_page", "discount_page"] as const;
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      buildPageContent(TYPES[i % TYPES.length], faqs);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  });

  it("faqsForPageType: 50 FAQs resolved < 5ms", () => {
    const faqs = makeFaqs(50);
    const start = performance.now();
    const result = faqsForPageType("shipping_page", faqs);
    const elapsed = performance.now() - start;
    expect(result).toBeDefined();
    expect(elapsed).toBeLessThan(5);
  });

  it("filterLibraryItems: 1000 items filtered < 50ms", () => {
    const items = makeLibraryItems(1000);
    const start = performance.now();
    const filtered = filterLibraryItems(items, { itemType: "faq", status: "active", search: "shipping" });
    const elapsed = performance.now() - start;
    expect(filtered.length).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(50);
  });

  it("sortLibraryItems: 1000 items sorted < 20ms", () => {
    const items = makeLibraryItems(1000);
    const start = performance.now();
    const sorted = sortLibraryItems(items, "createdAt", "desc");
    const elapsed = performance.now() - start;
    expect(sorted).toHaveLength(1000);
    expect(elapsed).toBeLessThan(20);
  });
});
