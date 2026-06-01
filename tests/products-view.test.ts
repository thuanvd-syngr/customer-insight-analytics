import { describe, expect, it } from "vitest";

import { getProductsPageState } from "~/lib/products-view";

describe("products page state", () => {
  it("does not show sync empty state when 18 products exist and there are 0 findings", () => {
    expect(getProductsPageState({
      shopifyProductCount: 18,
      productFindingCount: 0,
      insightRunCount: 0,
      products: [],
    })).toBe("needs_analysis");
  });

  it("renders recovery center when 18 products and 12 findings exist", () => {
    expect(getProductsPageState({
      shopifyProductCount: 18,
      productFindingCount: 12,
      insightRunCount: 1,
      products: Array.from({ length: 12 }, (_, index) => ({
        productId: `gid://shopify/Product/${index}`,
        productTitle: `Product ${index}`,
        mentionCount: 2,
        confusionScore: 50,
        topGroups: ["shipping"],
      })),
    })).toBe("recovery");
  });
});
