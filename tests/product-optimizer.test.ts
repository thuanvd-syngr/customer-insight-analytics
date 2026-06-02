import { describe, expect, it } from "vitest";

import {
  buildRuleBasedProductSection,
  parseProductOptimizationResponse,
  buildProductOptimizationPrompt,
  SECTION_TYPE_LABELS,
  PRODUCT_SECTION_TYPES,
  type ProductOptimizationInput,
} from "~/lib/product-optimizer";

const BASE_INPUT: ProductOptimizationInput = {
  productId: "gid://shopify/Product/123",
  productTitle: "Test Snowboard",
  sectionType: "description",
  storeName: "Test Store",
  shopDomain: "test.myshopify.com",
};

describe("buildRuleBasedProductSection", () => {
  it("returns all required fields", () => {
    const result = buildRuleBasedProductSection(BASE_INPUT);
    expect(result.sectionType).toBe("description");
    expect(result.draftContent.length).toBeGreaterThan(0);
    expect(result.draftHtml.length).toBeGreaterThan(0);
    expect(result.source).toBe("rule");
    expect(result.characterCount).toBe(result.draftContent.length);
  });

  it("generates for every section type without throwing", () => {
    for (const sectionType of PRODUCT_SECTION_TYPES) {
      const result = buildRuleBasedProductSection({ ...BASE_INPUT, sectionType });
      expect(result.draftContent.length).toBeGreaterThan(0);
      expect(result.draftHtml.length).toBeGreaterThan(0);
    }
  });

  it("clamps seo_title to 60 characters", () => {
    const result = buildRuleBasedProductSection({ ...BASE_INPUT, sectionType: "seo_title" });
    expect(result.draftContent.length).toBeLessThanOrEqual(60);
  });

  it("clamps meta_description to 160 characters", () => {
    const result = buildRuleBasedProductSection({ ...BASE_INPUT, sectionType: "meta_description" });
    expect(result.draftContent.length).toBeLessThanOrEqual(160);
  });

  it("benefits section contains list items", () => {
    const result = buildRuleBasedProductSection({ ...BASE_INPUT, sectionType: "benefits" });
    expect(result.draftHtml).toContain("<ul>");
    expect(result.draftHtml).toContain("<li>");
  });

  it("objection_handling section contains Q&A", () => {
    const result = buildRuleBasedProductSection({ ...BASE_INPUT, sectionType: "objection_handling" });
    expect(result.draftContent).toContain("Q:");
    expect(result.draftContent).toContain("A:");
  });

  it("trust section contains credibility points", () => {
    const result = buildRuleBasedProductSection({ ...BASE_INPUT, sectionType: "trust" });
    expect(result.draftHtml).toContain("<ul>");
  });

  it("does not include unescaped XSS in HTML output", () => {
    const result = buildRuleBasedProductSection({
      ...BASE_INPUT,
      productTitle: "<script>alert(1)</script>",
      sectionType: "description",
    });
    expect(result.draftHtml).not.toContain("<script>");
    expect(result.draftHtml).toContain("&lt;script&gt;");
  });

  it("includes product title in description content", () => {
    const result = buildRuleBasedProductSection({ ...BASE_INPUT, sectionType: "description" });
    expect(result.draftContent).toContain("Test Snowboard");
  });
});

describe("parseProductOptimizationResponse", () => {
  it("parses valid JSON response", () => {
    const raw = JSON.stringify({
      draftContent: "Great product for all skill levels.",
      draftHtml: "<p>Great product for all skill levels.</p>",
    });
    const result = parseProductOptimizationResponse(raw, BASE_INPUT);
    expect(result).not.toBeNull();
    expect(result?.source).toBe("ai");
    expect(result?.draftContent).toContain("Great product");
  });

  it("extracts JSON from surrounding prose", () => {
    const raw = `Here is the content:\n${JSON.stringify({ draftContent: "Content.", draftHtml: "<p>Content.</p>" })}`;
    const result = parseProductOptimizationResponse(raw, BASE_INPUT);
    expect(result).not.toBeNull();
    expect(result?.draftContent).toBe("Content.");
  });

  it("returns null for non-JSON input", () => {
    expect(parseProductOptimizationResponse("not json", BASE_INPUT)).toBeNull();
  });

  it("returns null when draftContent is missing", () => {
    const raw = JSON.stringify({ draftHtml: "<p>hi</p>" });
    expect(parseProductOptimizationResponse(raw, BASE_INPUT)).toBeNull();
  });

  it("clamps seo_title to 60 chars", () => {
    const raw = JSON.stringify({
      draftContent: "A".repeat(80),
      draftHtml: "<title>AAAA</title>",
    });
    const result = parseProductOptimizationResponse(raw, { ...BASE_INPUT, sectionType: "seo_title" });
    expect(result?.draftContent.length).toBeLessThanOrEqual(60);
  });

  it("clamps meta_description to 160 chars", () => {
    const raw = JSON.stringify({
      draftContent: "B".repeat(200),
      draftHtml: "<meta />",
    });
    const result = parseProductOptimizationResponse(raw, { ...BASE_INPUT, sectionType: "meta_description" });
    expect(result?.draftContent.length).toBeLessThanOrEqual(160);
  });
});

describe("buildProductOptimizationPrompt", () => {
  it("returns system and user strings", () => {
    const prompt = buildProductOptimizationPrompt(BASE_INPUT);
    expect(prompt.system.length).toBeGreaterThan(0);
    expect(prompt.user.length).toBeGreaterThan(0);
  });

  it("includes product title in prompt", () => {
    const prompt = buildProductOptimizationPrompt(BASE_INPUT);
    expect(prompt.user).toContain("Test Snowboard");
  });

  it("includes competitor name when provided", () => {
    const prompt = buildProductOptimizationPrompt({ ...BASE_INPUT, additionalContext: "Competitor: RivalBrand" });
    expect(prompt.user).toContain("RivalBrand");
  });

  it("includes section-specific instructions", () => {
    const prompt = buildProductOptimizationPrompt({ ...BASE_INPUT, sectionType: "seo_title" });
    expect(prompt.user).toContain("60 characters");
  });
});

describe("SECTION_TYPE_LABELS", () => {
  it("has a label for every section type", () => {
    for (const t of PRODUCT_SECTION_TYPES) {
      expect(SECTION_TYPE_LABELS[t]).toBeTruthy();
    }
  });

  it("covers all 10 expected types", () => {
    expect(PRODUCT_SECTION_TYPES).toHaveLength(10);
  });
});
