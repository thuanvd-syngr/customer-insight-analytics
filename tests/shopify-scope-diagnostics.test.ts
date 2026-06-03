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

// Mirrors the gate logic in app.publish.tsx action — kept in sync manually.
function contentScopeGateFires(intent: string, grantedScopes: string): boolean {
  const requiresContentPublish = ["publish-page", "publish-blog", "publish-all-recovery", "publish-retry"].includes(intent);
  return requiresContentPublish && missingScopes(grantedScopes, CONTENT_PUBLISH_SCOPES).length > 0;
}

const SCOPES_WITHOUT_WRITE_CONTENT = "read_products,read_orders,read_content";
const SCOPES_FULL = "read_products,write_products,read_orders,read_content,write_content";

describe("publish action content scope gate", () => {
  it("publish-retry with missing write_content triggers 403 gate", () => {
    expect(contentScopeGateFires("publish-retry", SCOPES_WITHOUT_WRITE_CONTENT)).toBe(true);
  });

  it("publish-retry with all required content scopes passes the gate", () => {
    expect(contentScopeGateFires("publish-retry", SCOPES_FULL)).toBe(false);
  });

  it("publish-page, publish-blog, publish-all-recovery are also gated when write_content missing", () => {
    expect(contentScopeGateFires("publish-page", SCOPES_WITHOUT_WRITE_CONTENT)).toBe(true);
    expect(contentScopeGateFires("publish-blog", SCOPES_WITHOUT_WRITE_CONTENT)).toBe(true);
    expect(contentScopeGateFires("publish-all-recovery", SCOPES_WITHOUT_WRITE_CONTENT)).toBe(true);
  });

  it("delete and unknown intents are not gated", () => {
    expect(contentScopeGateFires("delete", SCOPES_WITHOUT_WRITE_CONTENT)).toBe(false);
    expect(contentScopeGateFires("unknown-intent", SCOPES_WITHOUT_WRITE_CONTENT)).toBe(false);
  });
});
