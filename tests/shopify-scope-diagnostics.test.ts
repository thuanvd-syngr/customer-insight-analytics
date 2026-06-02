import { describe, expect, it } from "vitest";

import {
  CONTENT_PUBLISH_SCOPES,
  PRODUCT_FAQ_PUBLISH_SCOPES,
  missingScopes,
  parseShopifyScopes,
} from "~/lib/action-loading";

describe("Shopify publish scope diagnostics", () => {
  it("detects missing content publish scopes", () => {
    expect(missingScopes("read_products,read_orders,read_content", CONTENT_PUBLISH_SCOPES)).toEqual(["write_content"]);
  });

  it("detects missing product FAQ publish scopes", () => {
    expect(missingScopes("read_products,read_content,write_content", PRODUCT_FAQ_PUBLISH_SCOPES)).toEqual(["write_products"]);
  });

  it("accepts complete production publish scopes", () => {
    const scopes = "read_products,write_products,read_orders,read_content,write_content";
    expect(missingScopes(scopes, CONTENT_PUBLISH_SCOPES)).toEqual([]);
    expect(missingScopes(scopes, PRODUCT_FAQ_PUBLISH_SCOPES)).toEqual([]);
    expect(parseShopifyScopes(scopes).has("write_content")).toBe(true);
  });
});
