import { describe, expect, it } from "vitest";

import {
  getMissingFromRequired,
  checkScopesForAction,
  REQUIRED_APP_SCOPES,
  REQUIRED_SYNC_SCOPES,
} from "~/lib/scope-guard.server";

// The stale scope string that reproduces the reported production bug:
// session.scope = read_orders,write_content,write_products
// (missing read_products and read_content)
const STALE_SCOPE = "read_orders,write_content,write_products";
const FULL_SCOPE = "read_products,write_products,read_orders,read_content,write_content";

const SESSION = { shop: "test.myshopify.com", id: "sess_abc123" };

describe("getMissingFromRequired", () => {
  it("stale session missing read_products is detected", () => {
    const missing = getMissingFromRequired(STALE_SCOPE, REQUIRED_APP_SCOPES);
    expect(missing).toContain("read_products");
  });

  it("stale session missing read_content is detected", () => {
    const missing = getMissingFromRequired(STALE_SCOPE, REQUIRED_APP_SCOPES);
    expect(missing).toContain("read_content");
  });

  it("full session returns no missing scopes", () => {
    expect(getMissingFromRequired(FULL_SCOPE, REQUIRED_APP_SCOPES)).toEqual([]);
  });

  it("null/undefined scope is treated as empty", () => {
    expect(getMissingFromRequired(null, REQUIRED_APP_SCOPES)).toEqual(Array.from(REQUIRED_APP_SCOPES));
    expect(getMissingFromRequired(undefined, REQUIRED_APP_SCOPES)).toEqual(Array.from(REQUIRED_APP_SCOPES));
  });

  it("handles extra whitespace in scope string", () => {
    const spaced = " read_products , write_products , read_orders , read_content , write_content ";
    expect(getMissingFromRequired(spaced, REQUIRED_APP_SCOPES)).toEqual([]);
  });

  it("order of scopes in the granted string does not matter", () => {
    const reversed = "write_content,read_content,read_orders,write_products,read_products";
    expect(getMissingFromRequired(reversed, REQUIRED_APP_SCOPES)).toEqual([]);
  });
});

describe("checkScopesForAction — stale session blocks sync", () => {
  it("returns ok:false and lists missing read_products when stale", () => {
    const result = checkScopesForAction(
      { ...SESSION, scope: STALE_SCOPE },
      REQUIRED_SYNC_SCOPES,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toContain("read_products");
    }
  });

  it("returns ok:false when only read_orders is missing", () => {
    const result = checkScopesForAction(
      { ...SESSION, scope: "read_products,write_products,write_content" },
      REQUIRED_SYNC_SCOPES,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toContain("read_orders");
    }
  });

  it("returns ok:false when only read_products is missing", () => {
    const result = checkScopesForAction(
      { ...SESSION, scope: "read_orders,write_products,write_content" },
      REQUIRED_SYNC_SCOPES,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toContain("read_products");
    }
  });

  it("returns ok:true with full scopes — sync is not blocked", () => {
    const result = checkScopesForAction(
      { ...SESSION, scope: FULL_SCOPE },
      REQUIRED_SYNC_SCOPES,
    );
    expect(result.ok).toBe(true);
  });

  it("reports all missing scopes in a single call", () => {
    const result = checkScopesForAction(
      { ...SESSION, scope: STALE_SCOPE },
      Array.from(REQUIRED_APP_SCOPES),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toContain("read_products");
      expect(result.missing).toContain("read_content");
      expect(result.missing).not.toContain("read_orders");
      expect(result.missing).not.toContain("write_content");
      expect(result.missing).not.toContain("write_products");
    }
  });
});
