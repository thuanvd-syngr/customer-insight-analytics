import { describe, expect, it } from "vitest";

import {
  filterLibraryItems,
  getLibraryStats,
  sortLibraryItems,
  truncateContent,
  parseTags,
  serializeTags,
  buildLibraryItemFromFaq,
  buildLibraryItemFromPublished,
  ITEM_TYPE_LABELS,
  SOURCE_LABELS,
  type LibraryItem,
} from "~/lib/content-library";

const SAMPLE_ITEMS: LibraryItem[] = [
  {
    id: "1",
    itemType: "faq",
    title: "What is your shipping policy?",
    content: "We ship in 2-3 business days.",
    tags: ["shipping"],
    groupId: "shipping",
    productId: null,
    source: "generated",
    status: "active",
    usageCount: 5,
    createdAt: "2026-05-01T00:00:00Z",
  },
  {
    id: "2",
    itemType: "blog_tip",
    title: "5 Ways to Reduce Cart Abandonment",
    content: "Cart abandonment can be reduced with clear FAQs.",
    tags: ["shipping", "conversion"],
    groupId: null,
    productId: null,
    source: "manual",
    status: "active",
    usageCount: 2,
    createdAt: "2026-05-10T00:00:00Z",
  },
  {
    id: "3",
    itemType: "page_template",
    title: "Return Policy Template",
    content: "Our 30-day return policy covers all items.",
    tags: ["return"],
    groupId: "return",
    productId: null,
    source: "generated",
    status: "archived",
    usageCount: 1,
    createdAt: "2026-04-15T00:00:00Z",
  },
  {
    id: "4",
    itemType: "faq",
    title: "Do you accept returns?",
    content: "Yes, within 30 days.",
    tags: ["return"],
    groupId: "return",
    productId: "gid://shopify/Product/1",
    source: "generated",
    status: "active",
    usageCount: 3,
    createdAt: "2026-05-20T00:00:00Z",
  },
  {
    id: "5",
    itemType: "social_post",
    title: "Instagram Post — Shipping Update",
    content: "We now offer free shipping on all orders! 🚚",
    tags: ["shipping", "social"],
    groupId: "shipping",
    productId: null,
    source: "generated",
    status: "active",
    usageCount: 0,
    createdAt: "2026-06-01T00:00:00Z",
  },
];

// ─── parseTags / serializeTags ────────────────────────────────────────────────

describe("parseTags", () => {
  it("parses valid JSON array", () => {
    expect(parseTags('["shipping","return"]')).toEqual(["shipping", "return"]);
  });

  it("returns empty array for null", () => {
    expect(parseTags(null)).toEqual([]);
  });

  it("returns empty array for undefined", () => {
    expect(parseTags(undefined)).toEqual([]);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseTags("not-json")).toEqual([]);
  });

  it("returns empty array for non-array JSON", () => {
    expect(parseTags('{"key":"value"}')).toEqual([]);
  });
});

describe("serializeTags", () => {
  it("serializes string array to JSON", () => {
    const result = serializeTags(["shipping", "return"]);
    expect(JSON.parse(result)).toEqual(["shipping", "return"]);
  });

  it("filters empty strings", () => {
    const result = serializeTags(["shipping", "", "return"]);
    const parsed = JSON.parse(result);
    expect(parsed).not.toContain("");
    expect(parsed).toContain("shipping");
  });

  it("handles empty array", () => {
    expect(JSON.parse(serializeTags([]))).toEqual([]);
  });
});

// ─── filterLibraryItems ───────────────────────────────────────────────────────

describe("filterLibraryItems", () => {
  it("returns all items with empty filter", () => {
    expect(filterLibraryItems(SAMPLE_ITEMS, {})).toHaveLength(SAMPLE_ITEMS.length);
  });

  it("filters by itemType", () => {
    const faqs = filterLibraryItems(SAMPLE_ITEMS, { itemType: "faq" });
    expect(faqs.every((i) => i.itemType === "faq")).toBe(true);
    expect(faqs).toHaveLength(2);
  });

  it("filters by status archived", () => {
    const archived = filterLibraryItems(SAMPLE_ITEMS, { status: "archived" });
    expect(archived).toHaveLength(1);
    expect(archived[0].id).toBe("3");
  });

  it("filters by groupId", () => {
    const shipping = filterLibraryItems(SAMPLE_ITEMS, { groupId: "shipping" });
    expect(shipping.every((i) => i.groupId === "shipping")).toBe(true);
  });

  it("filters by search term in title", () => {
    const results = filterLibraryItems(SAMPLE_ITEMS, { search: "return" });
    expect(results.some((i) => i.title.toLowerCase().includes("return"))).toBe(true);
  });

  it("filters by search term in content", () => {
    const results = filterLibraryItems(SAMPLE_ITEMS, { search: "cart abandonment" });
    expect(results.length).toBeGreaterThan(0);
  });

  it("search is case-insensitive", () => {
    const results = filterLibraryItems(SAMPLE_ITEMS, { search: "SHIPPING" });
    expect(results.length).toBeGreaterThan(0);
  });

  it("combines multiple filters", () => {
    const results = filterLibraryItems(SAMPLE_ITEMS, { itemType: "faq", groupId: "shipping" });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("1");
  });
});

// ─── getLibraryStats ──────────────────────────────────────────────────────────

describe("getLibraryStats", () => {
  it("counts total correctly", () => {
    expect(getLibraryStats(SAMPLE_ITEMS).total).toBe(5);
  });

  it("counts active correctly", () => {
    expect(getLibraryStats(SAMPLE_ITEMS).active).toBe(4);
  });

  it("counts archived correctly", () => {
    expect(getLibraryStats(SAMPLE_ITEMS).archived).toBe(1);
  });

  it("counts by type correctly", () => {
    const stats = getLibraryStats(SAMPLE_ITEMS);
    expect(stats.byType.faq).toBe(2);
    expect(stats.byType.blog_tip).toBe(1);
    expect(stats.byType.page_template).toBe(1);
    expect(stats.byType.social_post).toBe(1);
  });

  it("calculates total usage", () => {
    const stats = getLibraryStats(SAMPLE_ITEMS);
    expect(stats.totalUsage).toBe(5 + 2 + 1 + 3 + 0);
  });

  it("returns empty stats for empty array", () => {
    const stats = getLibraryStats([]);
    expect(stats.total).toBe(0);
    expect(stats.active).toBe(0);
    expect(stats.mostUsedType).toBeNull();
  });
});

// ─── sortLibraryItems ─────────────────────────────────────────────────────────

describe("sortLibraryItems", () => {
  it("sorts by createdAt desc by default", () => {
    const sorted = sortLibraryItems(SAMPLE_ITEMS, "createdAt", "desc");
    expect(sorted[0].createdAt > sorted[1].createdAt).toBe(true);
  });

  it("sorts by createdAt asc", () => {
    const sorted = sortLibraryItems(SAMPLE_ITEMS, "createdAt", "asc");
    expect(sorted[0].createdAt < sorted[sorted.length - 1].createdAt).toBe(true);
  });

  it("sorts by usageCount desc", () => {
    const sorted = sortLibraryItems(SAMPLE_ITEMS, "usageCount", "desc");
    expect(sorted[0].usageCount >= sorted[1].usageCount).toBe(true);
  });

  it("sorts by title asc", () => {
    const sorted = sortLibraryItems(SAMPLE_ITEMS, "title", "asc");
    expect(sorted[0].title.localeCompare(sorted[1].title) <= 0).toBe(true);
  });

  it("does not mutate original array", () => {
    const original = [...SAMPLE_ITEMS];
    sortLibraryItems(SAMPLE_ITEMS, "title", "asc");
    expect(SAMPLE_ITEMS[0].id).toBe(original[0].id);
  });
});

// ─── truncateContent ──────────────────────────────────────────────────────────

describe("truncateContent", () => {
  it("returns original content if within limit", () => {
    const content = "Short content";
    expect(truncateContent(content)).toBe(content);
  });

  it("truncates long content with ellipsis", () => {
    const content = "A".repeat(300);
    const result = truncateContent(content);
    expect(result.length).toBe(200);
    expect(result.endsWith("...")).toBe(true);
  });

  it("respects custom maxLen", () => {
    const content = "A".repeat(100);
    const result = truncateContent(content, 50);
    expect(result.length).toBe(50);
  });
});

// ─── buildLibraryItemFromFaq ─────────────────────────────────────────────────

describe("buildLibraryItemFromFaq", () => {
  const faq = {
    id: "faq-1",
    question: "What is your shipping policy?",
    answerText: "We ship in 2-3 business days",
    groupId: "shipping",
    productId: null,
    productTitle: null,
    source: "ai",
    createdAt: new Date("2026-05-01"),
  };

  it("maps id correctly", () => {
    expect(buildLibraryItemFromFaq(faq).id).toBe("faq-1");
  });

  it("sets itemType to faq", () => {
    expect(buildLibraryItemFromFaq(faq).itemType).toBe("faq");
  });

  it("uses question as title", () => {
    expect(buildLibraryItemFromFaq(faq).title).toBe(faq.question);
  });

  it("uses answerText as content", () => {
    expect(buildLibraryItemFromFaq(faq).content).toBe(faq.answerText);
  });

  it("maps ai source to generated", () => {
    expect(buildLibraryItemFromFaq(faq).source).toBe("generated");
  });

  it("maps rule source to manual", () => {
    expect(buildLibraryItemFromFaq({ ...faq, source: "rule" }).source).toBe("manual");
  });
});

// ─── ITEM_TYPE_LABELS ────────────────────────────────────────────────────────

describe("ITEM_TYPE_LABELS", () => {
  it("has a label for each item type", () => {
    const types = ["faq", "blog_tip", "page_template", "email_snippet", "social_post"] as const;
    for (const t of types) {
      expect(ITEM_TYPE_LABELS[t]).toBeTruthy();
    }
  });
});
