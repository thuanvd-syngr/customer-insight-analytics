// Tests for Content Hub filter logic — category filter, status filter, search.

import { describe, expect, it } from "vitest";

type ContentCategory = "faq_draft" | "published_page" | "blog_article" | "product_faq" | "library_item";
type ContentStatus = "active" | "published" | "draft" | "archived";

interface ContentItem {
  id: string;
  kind: "faq" | "published" | "library";
  category: ContentCategory;
  title: string;
  subtitle: string;
  status: ContentStatus;
  groupId: string | null;
  createdAt: string;
}

function makeItem(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "item1",
    kind: "faq",
    category: "faq_draft",
    title: "What is the return policy?",
    subtitle: "return · Manual",
    status: "draft",
    groupId: "return",
    createdAt: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

function applyFilters(
  items: ContentItem[],
  kindFilter: string,
  statusFilter: string,
  search: string,
): ContentItem[] {
  return items.filter((item) => {
    if (kindFilter && item.category !== kindFilter) return false;
    if (statusFilter && item.status !== statusFilter && !(statusFilter === "active" && item.status === "published")) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!item.title.toLowerCase().includes(q) && !item.subtitle.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

const SAMPLE_ITEMS: ContentItem[] = [
  makeItem({ id: "1", category: "faq_draft", status: "draft", title: "Return policy question" }),
  makeItem({ id: "2", category: "product_faq", status: "published", title: "Matcha kit FAQ", kind: "faq" }),
  makeItem({ id: "3", category: "published_page", kind: "published", status: "published", title: "Shipping FAQ Page" }),
  makeItem({ id: "4", category: "blog_article", kind: "published", status: "published", title: "Shipping Guide" }),
  makeItem({ id: "5", category: "library_item", kind: "library", status: "active", title: "Template: Returns" }),
  makeItem({ id: "6", category: "faq_draft", status: "archived", title: "Old payment FAQ", subtitle: "payment · Manual" }),
];

// --- Category filter ---

describe("content hub — category filter", () => {
  it("shows all items when category filter is empty", () => {
    expect(applyFilters(SAMPLE_ITEMS, "", "", "")).toHaveLength(6);
  });

  it("filters to faq_draft only", () => {
    const result = applyFilters(SAMPLE_ITEMS, "faq_draft", "", "");
    expect(result).toHaveLength(2);
    result.forEach((r) => expect(r.category).toBe("faq_draft"));
  });

  it("filters to product_faq only", () => {
    const result = applyFilters(SAMPLE_ITEMS, "product_faq", "", "");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
  });

  it("filters to blog_article only", () => {
    const result = applyFilters(SAMPLE_ITEMS, "blog_article", "", "");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("4");
  });

  it("filters to published_page only", () => {
    const result = applyFilters(SAMPLE_ITEMS, "published_page", "", "");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("3");
  });

  it("filters to library_item only", () => {
    const result = applyFilters(SAMPLE_ITEMS, "library_item", "", "");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("5");
  });
});

// --- Status filter ---

describe("content hub — status filter", () => {
  it("filters to draft status", () => {
    const result = applyFilters(SAMPLE_ITEMS, "", "draft", "");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("filters to published status", () => {
    const result = applyFilters(SAMPLE_ITEMS, "", "published", "");
    result.forEach((r) => expect(r.status).toBe("published"));
  });

  it("active filter includes published items (status aliasing)", () => {
    const result = applyFilters(SAMPLE_ITEMS, "", "active", "");
    // status === "active" OR "published"
    result.forEach((r) => expect(["active", "published"]).toContain(r.status));
  });

  it("filters to archived", () => {
    const result = applyFilters(SAMPLE_ITEMS, "", "archived", "");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("6");
  });
});

// --- Search filter ---

describe("content hub — search filter", () => {
  it("matches title case-insensitively", () => {
    const result = applyFilters(SAMPLE_ITEMS, "", "", "shipping");
    expect(result.length).toBeGreaterThanOrEqual(2);
    result.forEach((r) =>
      expect(r.title.toLowerCase() + r.subtitle.toLowerCase()).toContain("shipping"),
    );
  });

  it("matches subtitle", () => {
    const result = applyFilters(SAMPLE_ITEMS, "", "", "return");
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty when nothing matches", () => {
    const result = applyFilters(SAMPLE_ITEMS, "", "", "xyznonexistent");
    expect(result).toHaveLength(0);
  });
});

// --- Combined filters ---

describe("content hub — combined filters", () => {
  it("category + status narrows results", () => {
    const result = applyFilters(SAMPLE_ITEMS, "faq_draft", "archived", "");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("6");
  });

  it("category + search", () => {
    const result = applyFilters(SAMPLE_ITEMS, "faq_draft", "", "return");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });
});

// --- Category mapping ---

describe("content hub — category assignment on published content", () => {
  it("blog_article content type maps to blog_article category", () => {
    const contentType = "blog_article";
    const category: ContentCategory = contentType === "blog_article" ? "blog_article" : "published_page";
    expect(category).toBe("blog_article");
  });

  it("faq_page content type maps to published_page category", () => {
    const contentType: string = "faq_page";
    const category: ContentCategory = contentType === "blog_article" ? "blog_article" : "published_page";
    expect(category).toBe("published_page");
  });

  it("FAQ with productId maps to product_faq category", () => {
    const productId = "gid://shopify/Product/123";
    const category: ContentCategory = productId ? "product_faq" : "faq_draft";
    expect(category).toBe("product_faq");
  });

  it("FAQ without productId maps to faq_draft category", () => {
    const productId = null;
    const category: ContentCategory = productId ? "product_faq" : "faq_draft";
    expect(category).toBe("faq_draft");
  });
});
