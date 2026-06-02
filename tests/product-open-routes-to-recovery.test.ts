import { describe, expect, it } from "vitest";

import { productRecoveryPath } from "~/lib/action-loading";

describe("product open routes to recovery", () => {
  it("encodes Shopify product GIDs and appends /recovery", () => {
    expect(productRecoveryPath("gid://shopify/Product/123")).toBe(
      "/app/products/gid%3A%2F%2Fshopify%2FProduct%2F123/recovery",
    );
  });

  it("does not route to raw /app/products/:id", () => {
    const path = productRecoveryPath("gid://shopify/Product/123");
    expect(path.endsWith("/recovery")).toBe(true);
    expect(path).not.toBe("/app/products/gid%3A%2F%2Fshopify%2FProduct%2F123");
  });
});
