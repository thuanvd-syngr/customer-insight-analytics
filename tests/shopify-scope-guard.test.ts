import { describe, expect, it } from "vitest";

import {
  checkExpiringOfflineTokenForAction,
  getMissingFromRequired,
  isLegacyNonExpiringOfflineSession,
  requireExpiringOfflineTokenOrRedirect,
  checkScopesForAction,
  requireScopesOrRedirect,
  REQUIRED_APP_SCOPES,
  REQUIRED_SYNC_SCOPES,
} from "~/lib/scope-guard.server";

// The scope Shopify actually grants when the app requests write_products and
// write_content — Shopify omits the corresponding read_* scopes because the
// write scope implies them. After the implied-scope fix, this is HEALTHY.
const SHOPIFY_GRANTED_SCOPE = "read_orders,write_content,write_products";

// A session that is genuinely stale: missing read_orders (no write scope implies it).
const TRULY_STALE_SCOPE = "write_products,write_content";

// A session missing write_products (and therefore read_products too, since no implied grant).
const NO_PRODUCT_SCOPE = "read_orders,write_content";

// A session missing write_content (and therefore read_content too).
const NO_CONTENT_SCOPE = "read_orders,write_products";

const FULL_SCOPE = "read_products,write_products,read_orders,read_content,write_content";

const SESSION = { shop: "test.myshopify.com", id: "sess_abc123" };

describe("getMissingFromRequired", () => {
  it("write_products satisfies read_products — not treated as missing", () => {
    const missing = getMissingFromRequired(SHOPIFY_GRANTED_SCOPE, REQUIRED_APP_SCOPES);
    expect(missing).not.toContain("read_products");
  });

  it("write_content satisfies read_content — not treated as missing", () => {
    const missing = getMissingFromRequired(SHOPIFY_GRANTED_SCOPE, REQUIRED_APP_SCOPES);
    expect(missing).not.toContain("read_content");
  });

  it("Shopify-granted scope (read_orders,write_content,write_products) is fully satisfied", () => {
    expect(getMissingFromRequired(SHOPIFY_GRANTED_SCOPE, REQUIRED_APP_SCOPES)).toEqual([]);
  });

  it("read_products is missing when neither read_products nor write_products is granted", () => {
    const missing = getMissingFromRequired(NO_PRODUCT_SCOPE, REQUIRED_APP_SCOPES);
    expect(missing).toContain("read_products");
    expect(missing).toContain("write_products");
  });

  it("read_content is missing when neither read_content nor write_content is granted", () => {
    const missing = getMissingFromRequired(NO_CONTENT_SCOPE, REQUIRED_APP_SCOPES);
    expect(missing).toContain("read_content");
    expect(missing).toContain("write_content");
  });

  it("read_orders still requires explicit grant — not implied by any write scope", () => {
    const missing = getMissingFromRequired(TRULY_STALE_SCOPE, REQUIRED_APP_SCOPES);
    expect(missing).toContain("read_orders");
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

describe("requireScopesOrRedirect", () => {
  it("does not throw for Shopify-granted scope — write_* implies read_*", () => {
    expect(() => {
      requireScopesOrRedirect({ ...SESSION, scope: SHOPIFY_GRANTED_SCOPE });
    }).not.toThrow();
  });

  it("sessionHealthy true for read_orders,write_content,write_products", () => {
    // This is the scope Shopify was granting in production. After the implied-scope
    // fix it must not trigger a reauthorize redirect.
    expect(() => {
      requireScopesOrRedirect({ ...SESSION, scope: "read_orders,write_content,write_products" });
    }).not.toThrow();
  });

  it("throws a redirect to /auth/reauthorize when read_orders is missing", () => {
    let thrown: unknown;
    try {
      requireScopesOrRedirect({ ...SESSION, scope: TRULY_STALE_SCOPE });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Response);
    const location = (thrown as Response).headers.get("Location");
    expect(location).toMatch(/^\/auth\/reauthorize\?shop=/);
    expect(location).toContain("test.myshopify.com");
  });

  it("includes the shop domain in the reauthorize redirect URL", () => {
    let thrown: unknown;
    try {
      requireScopesOrRedirect({ shop: "my-store.myshopify.com", id: "sess_xyz", scope: TRULY_STALE_SCOPE });
    } catch (e) {
      thrown = e;
    }
    const location = (thrown as Response).headers.get("Location");
    expect(location).toContain("my-store.myshopify.com");
  });

  it("does not throw when all required scopes are present explicitly", () => {
    expect(() => {
      requireScopesOrRedirect({ ...SESSION, scope: FULL_SCOPE });
    }).not.toThrow();
  });

  it("throws when write_products is absent and read_products is also absent", () => {
    let thrown: unknown;
    try {
      requireScopesOrRedirect({ ...SESSION, scope: NO_PRODUCT_SCOPE });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Response);
  });
});

describe("checkScopesForAction — stale session blocks sync", () => {
  it("returns ok:true for Shopify-granted scope — write_products satisfies read_products for sync", () => {
    // SHOPIFY_GRANTED_SCOPE has write_products which implies read_products.
    // Sync must be allowed; this was the false-positive that triggered the fix.
    const result = checkScopesForAction(
      { ...SESSION, scope: SHOPIFY_GRANTED_SCOPE },
      REQUIRED_SYNC_SCOPES,
    );
    expect(result.ok).toBe(true);
  });

  it("returns ok:false and lists missing read_products when neither read_products nor write_products granted", () => {
    const result = checkScopesForAction(
      { ...SESSION, scope: NO_PRODUCT_SCOPE },
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

  it("returns ok:false when write_products is absent and read_products absent — both are missing", () => {
    const result = checkScopesForAction(
      { ...SESSION, scope: "read_orders,write_content" },
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

  it("reports only genuinely missing scopes — no false positives for implied scopes", () => {
    // SHOPIFY_GRANTED_SCOPE should report zero missing scopes for the full set.
    const result = checkScopesForAction(
      { ...SESSION, scope: SHOPIFY_GRANTED_SCOPE },
      Array.from(REQUIRED_APP_SCOPES),
    );
    expect(result.ok).toBe(true);
  });

  it("reports read_orders as missing when the session truly lacks it", () => {
    const result = checkScopesForAction(
      { ...SESSION, scope: TRULY_STALE_SCOPE },
      Array.from(REQUIRED_APP_SCOPES),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toContain("read_orders");
      expect(result.missing).not.toContain("read_products");
      expect(result.missing).not.toContain("read_content");
    }
  });
});

describe("expiring offline token guard", () => {
  const LEGACY_OFFLINE_SESSION = {
    shop: "test.myshopify.com",
    id: "offline_test.myshopify.com",
    isOnline: false,
    expires: null,
    refreshToken: null,
  };

  it("detects legacy non-expiring offline sessions", () => {
    expect(isLegacyNonExpiringOfflineSession(LEGACY_OFFLINE_SESSION)).toBe(true);
  });

  it("does not flag expiring offline sessions with refresh token", () => {
    expect(isLegacyNonExpiringOfflineSession({
      ...LEGACY_OFFLINE_SESSION,
      expires: new Date(Date.now() + 60_000),
      refreshToken: "refresh-token",
    })).toBe(false);
  });

  it("does not flag online sessions", () => {
    expect(isLegacyNonExpiringOfflineSession({
      ...LEGACY_OFFLINE_SESSION,
      isOnline: true,
    })).toBe(false);
  });

  it("redirects legacy sessions to reauthorize", () => {
    let thrown: unknown;
    try {
      requireExpiringOfflineTokenOrRedirect(LEGACY_OFFLINE_SESSION);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).headers.get("Location")).toContain("/auth/reauthorize?shop=test.myshopify.com");
  });

  it("returns an action-safe reauthorize URL", () => {
    const result = checkExpiringOfflineTokenForAction(LEGACY_OFFLINE_SESSION);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("expiring offline token");
      expect(result.reauthorizeUrl).toBe("/auth/reauthorize?shop=test.myshopify.com");
    }
  });
});
