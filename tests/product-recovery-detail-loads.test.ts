import { describe, expect, it } from "vitest";

import { productRecoveryPath } from "~/lib/action-loading";

describe("product recovery detail loads", () => {
  it("uses the recovery detail route for product detail access", () => {
    const path = productRecoveryPath("gid://shopify/Product/123");
    expect(path).toContain("/app/products/");
    expect(path).toContain("/recovery");
  });
});
