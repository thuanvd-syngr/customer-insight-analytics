import { describe, expect, it } from "vitest";

import { isStandaloneAppRequest, standaloneLoginUrl } from "../app/routes/app";

describe("embedded app auth fallback", () => {
  it("detects direct app visits without Shopify context", () => {
    const request = new Request("https://example.com/app");

    expect(isStandaloneAppRequest(request)).toBe(true);
  });

  it("redirects shop-only visits through login", () => {
    const request = new Request("https://example.com/app?shop=indexboost-seo.myshopify.com");

    expect(isStandaloneAppRequest(request)).toBe(true);
    expect(standaloneLoginUrl(request)).toBe("/auth/login?shop=indexboost-seo.myshopify.com");
  });

  it("does not intercept embedded app subroutes", () => {
    const request = new Request("https://example.com/app/import");

    expect(isStandaloneAppRequest(request)).toBe(false);
  });

  it("does not intercept internal app redirects back to the app root", () => {
    const request = new Request("https://example.com/app", {
      headers: { Referer: "https://example.com/app/import" },
    });

    expect(isStandaloneAppRequest(request)).toBe(false);
  });

  it("allows embedded context params to reach embedded auth", () => {
    for (const param of ["host", "id_token", "embedded", "hmac", "timestamp"]) {
      const request = new Request(`https://example.com/app?${param}=value`);

      expect(isStandaloneAppRequest(request)).toBe(false);
    }
  });

  it("allows existing sessions to reach embedded auth", () => {
    const request = new Request("https://example.com/app", {
      headers: { Cookie: "shopify_app_session=session-id" },
    });

    expect(isStandaloneAppRequest(request)).toBe(false);
  });
});
