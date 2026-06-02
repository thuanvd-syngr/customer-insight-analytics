import { describe, expect, it } from "vitest";

import { getProductsPageState, shouldShowSyncedProducts } from "~/lib/products-view";

describe("products page state", () => {
  it("does not show sync empty state when 18 products exist and there are 0 findings", () => {
    expect(getProductsPageState({
      shopifyProductCount: 18,
      productFindingCount: 0,
      insightRunCount: 0,
      products: [],
    })).toBe("needs_analysis");
    expect(shouldShowSyncedProducts({ shopifyProductCount: 18 })).toBe(true);
  });

  it("shows synced products even when no recovery gaps exist", () => {
    expect(shouldShowSyncedProducts({ shopifyProductCount: 18 })).toBe(true);
    expect(getProductsPageState({
      shopifyProductCount: 18,
      productFindingCount: 0,
      insightRunCount: 1,
      products: [],
      contentGaps: [],
    })).toBe("no_findings");
  });

  it("shows sync empty state only when product count is zero", () => {
    expect(shouldShowSyncedProducts({ shopifyProductCount: 0 })).toBe(false);
    expect(getProductsPageState({
      shopifyProductCount: 0,
      productFindingCount: 12,
      insightRunCount: 1,
      products: [],
      contentGaps: [],
    })).toBe("needs_sync");
  });

  it("keeps synced product count independent from content gaps", () => {
    expect(getProductsPageState({
      shopifyProductCount: 18,
      productFindingCount: 0,
      insightRunCount: 1,
      products: [],
      contentGaps: [],
    })).not.toBe("needs_sync");
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
