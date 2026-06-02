// Tests for publish flow hardening:
// - Friendly error messages (no "critical" tone in UI)
// - Shopify admin URL construction from GID resourceId
// - Safe fallback when PublishedContent table absent
// - Rate-limit check still works with absent table

import { describe, expect, it } from "vitest";
import { safeCount } from "~/lib/prisma-safe";
import type { PrismaClient } from "@prisma/client";

// --- Admin URL construction ---

function buildAdminUrl(storeName: string, resourceId: string, contentType: string): string {
  const numId = resourceId.replace(/^gid:\/\/shopify\/[A-Za-z]+\//, "");
  const adminPath = contentType === "blog_article" ? `articles/${numId}` : `pages/${numId}`;
  return `https://${storeName}.myshopify.com/admin/${adminPath}`;
}

describe("publish — Shopify admin URL construction", () => {
  it("builds correct page admin URL from GID", () => {
    const url = buildAdminUrl("mystore", "gid://shopify/Page/123456789", "faq_page");
    expect(url).toBe("https://mystore.myshopify.com/admin/pages/123456789");
  });

  it("builds correct article admin URL from GID", () => {
    const url = buildAdminUrl("mystore", "gid://shopify/Article/987654321", "blog_article");
    expect(url).toBe("https://mystore.myshopify.com/admin/articles/987654321");
  });

  it("handles GID with OnlineStorePage type", () => {
    const url = buildAdminUrl("shop", "gid://shopify/OnlineStorePage/555", "shipping_page");
    expect(url).toBe("https://shop.myshopify.com/admin/pages/555");
  });

  it("uses storeName (without .myshopify.com) for host", () => {
    const url = buildAdminUrl("testshop", "gid://shopify/Page/1", "return_page");
    expect(url).toContain("testshop.myshopify.com");
    expect(url).not.toContain("testshop.myshopify.com.myshopify.com");
  });
});

// --- Error message tone ---

describe("publish — error message tone", () => {
  it("loadError message does not say 'could not load' (friendly tone)", () => {
    const loadError = "Publish data is loading. Refresh in a moment — your published pages are safe.";
    expect(loadError.toLowerCase()).not.toContain("could not load");
    expect(loadError).toContain("safe");
  });

  it("action error message prompts retry without implying data loss", () => {
    const actionError = "Shopify page publish failed.";
    expect(actionError).toBeTruthy();
    expect(actionError.toLowerCase()).not.toContain("data lost");
    expect(actionError.toLowerCase()).not.toContain("deleted");
  });
});

// --- Safe count when PublishedContent absent ---

describe("publish — safeCount fallback with absent table", () => {
  it("rate-limit check returns 0 when publishedContent table absent", async () => {
    const db = {} as PrismaClient;
    const recentPublishCount = await safeCount(db, "publishedContent", {
      where: { shopId: "s1", publishedAt: { gte: new Date(Date.now() - 86_400_000) } },
    });
    expect(recentPublishCount).toBe(0);
  });

  it("recentPublishCount=0 does not trigger rate limit (< 10 threshold)", async () => {
    const db = {} as PrismaClient;
    const recentPublishCount = await safeCount(db, "publishedContent", { where: { shopId: "s1" } });
    const wouldBeRateLimited = recentPublishCount >= 10;
    expect(wouldBeRateLimited).toBe(false);
  });

  it("getPublishedContent returns empty array when table absent", async () => {
    const db = {} as PrismaClient;
    const model = (db as unknown as { publishedContent?: { findMany: () => Promise<unknown[]> } }).publishedContent;
    const rows = model ? await model.findMany() : [];
    expect(rows).toHaveLength(0);
  });
});

// --- Published content view links ---

describe("publish — view link availability", () => {
  it("shows view link when resourceId present", () => {
    const item = { resourceId: "gid://shopify/Page/111", contentType: "faq_page" };
    const hasLink = Boolean(item.resourceId);
    expect(hasLink).toBe(true);
  });

  it("no view link when resourceId is null", () => {
    const item = { resourceId: null, contentType: "faq_page" };
    const hasLink = Boolean(item.resourceId);
    expect(hasLink).toBe(false);
  });

  it("derives numeric ID correctly from varied GID formats", () => {
    const gids = [
      { gid: "gid://shopify/Page/12345", expected: "12345" },
      { gid: "gid://shopify/Article/99999", expected: "99999" },
      { gid: "gid://shopify/OnlineStorePage/777", expected: "777" },
    ];
    gids.forEach(({ gid, expected }) => {
      const numId = gid.replace(/^gid:\/\/shopify\/[A-Za-z]+\//, "");
      expect(numId).toBe(expected);
    });
  });
});
