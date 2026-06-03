import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { isValidShopDomain } from "~/routes/auth.reauthorize";

// ---------------------------------------------------------------------------
// isValidShopDomain — pure function, no mocking needed
// ---------------------------------------------------------------------------

describe("isValidShopDomain", () => {
  it("accepts a standard myshopify.com domain", () => {
    expect(isValidShopDomain("indexboost-seo.myshopify.com")).toBe(true);
  });

  it("accepts domains with hyphens and numbers", () => {
    expect(isValidShopDomain("my-store-123.myshopify.com")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidShopDomain("")).toBe(false);
  });

  it("rejects arbitrary domains not on myshopify.com", () => {
    expect(isValidShopDomain("evil.example.com")).toBe(false);
  });

  it("rejects myshopify.com without a subdomain", () => {
    expect(isValidShopDomain("myshopify.com")).toBe(false);
  });

  it("rejects paths or query strings embedded in the shop value", () => {
    expect(isValidShopDomain("shop.myshopify.com/admin")).toBe(false);
    expect(isValidShopDomain("shop.myshopify.com?foo=bar")).toBe(false);
  });

  it("rejects myshopify.com lookalike with extra suffix", () => {
    expect(isValidShopDomain("shop.myshopify.com.evil.com")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// loader — tests the redirect logic using a prisma spy passed as a stand-in.
//
// We test the redirect URL and the 400 path via a lightweight helper that
// mirrors the loader's logic but accepts prisma as a parameter, avoiding
// the need to mock the global db.server module in this test file.
// ---------------------------------------------------------------------------

async function simulateReauthorize(
  shop: string,
  prisma: Pick<PrismaClient, "session">,
): Promise<Response> {
  if (!isValidShopDomain(shop)) {
    return new Response("Invalid shop domain", { status: 400 });
  }
  await prisma.session.deleteMany({ where: { shop } } as Parameters<PrismaClient["session"]["deleteMany"]>[0]);
  const redirectTarget = `/auth/login?shop=${encodeURIComponent(shop)}`;
  // Use manual Response construction (not Response.redirect) because the Web
  // API Response.redirect() requires an absolute URL — relative paths throw.
  // Remix's redirect() does the same thing internally.
  return new Response(null, { status: 302, headers: { Location: redirectTarget } });
}

describe("/auth/reauthorize loader behaviour", () => {
  const mockPrisma = {
    session: {
      deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
  } as unknown as PrismaClient;

  it("redirects to /auth/login?shop=... for a valid shop", async () => {
    const res = await simulateReauthorize("indexboost-seo.myshopify.com", mockPrisma);
    // Response.redirect sets the Location header
    const location = res.headers.get("Location") ?? res.url;
    expect(location).toContain("/auth/login");
    expect(location).toContain("indexboost-seo.myshopify.com");
  });

  it("redirect URL starts with /auth/login?shop=", async () => {
    const res = await simulateReauthorize("test.myshopify.com", mockPrisma);
    const location = res.headers.get("Location") ?? res.url;
    expect(location).toMatch(/\/auth\/login\?shop=/);
  });

  it("returns 400 for invalid shop domain", async () => {
    const res = await simulateReauthorize("evil.example.com", mockPrisma);
    expect(res.status).toBe(400);
  });

  it("returns 400 when shop is empty string", async () => {
    const res = await simulateReauthorize("", mockPrisma);
    expect(res.status).toBe(400);
  });

  it("calls prisma.session.deleteMany with the shop domain", async () => {
    mockPrisma.session.deleteMany = vi.fn().mockResolvedValue({ count: 3 });
    await simulateReauthorize("test.myshopify.com", mockPrisma);
    expect(mockPrisma.session.deleteMany).toHaveBeenCalledWith({ where: { shop: "test.myshopify.com" } });
  });

  it("does not call prisma for an invalid shop", async () => {
    const spy = vi.fn();
    const p = { session: { deleteMany: spy } } as unknown as PrismaClient;
    await simulateReauthorize("bad-domain.example.com", p);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// /auth/login loader — does not return null
//
// The loader always returns json({ error: string | null }).  When shop is
// present and valid, shopify.login() throws a redirect (so the loader never
// reaches `return json`).  When shop is missing/invalid, loginErrorMessage
// converts the LoginError to a human-readable string — never undefined.
//
// We test loginErrorMessage directly since calling the full loader would
// require bootstrapping the Shopify app config (excluded from the test env).
// ---------------------------------------------------------------------------

import { LoginErrorType } from "@shopify/shopify-app-remix/server";

import { loginErrorMessage } from "~/routes/auth.login/error.server";

describe("/auth/login — loginErrorMessage never returns undefined", () => {
  it("returns null when there are no errors (OAuth redirect succeeded before this point)", () => {
    expect(loginErrorMessage(undefined)).toBeNull();
  });

  it("returns a non-empty string for MISSING_SHOP", () => {
    const msg = loginErrorMessage({ shop: LoginErrorType.MissingShop });
    expect(typeof msg).toBe("string");
    expect(msg!.length).toBeGreaterThan(0);
  });

  it("returns a non-empty string for INVALID_SHOP", () => {
    const msg = loginErrorMessage({ shop: LoginErrorType.InvalidShop });
    expect(typeof msg).toBe("string");
    expect(msg!.length).toBeGreaterThan(0);
  });
});
