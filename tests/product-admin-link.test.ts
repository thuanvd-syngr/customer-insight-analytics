import { describe, expect, it } from "vitest";

import { extractShopifyNumericId, shopAdminProductUrl } from "~/lib/action-loading";

describe("product admin link", () => {
  it("extracts numeric product ID from Shopify GID", () => {
    expect(extractShopifyNumericId("gid://shopify/Product/987654321")).toBe("987654321");
  });

  it("builds Shopify Admin product URL from shop domain", () => {
    expect(shopAdminProductUrl("demo-store.myshopify.com", "gid://shopify/Product/987654321")).toBe(
      "https://admin.shopify.com/store/demo-store/products/987654321",
    );
  });

  it("returns null when numeric product ID is unavailable", () => {
    expect(shopAdminProductUrl("demo-store.myshopify.com", "manual-product-title")).toBeNull();
  });

  it("does not throw on malformed encoded product IDs", () => {
    expect(() => extractShopifyNumericId("gid%3A%2F%2Fshopify%2FProduct%2F%")).not.toThrow();
    expect(shopAdminProductUrl("demo-store.myshopify.com", "gid%3A%2F%2Fshopify%2FProduct%2F%")).toBeNull();
  });
});
