// Tests for PublishedContent safe-delegate fallback behavior.
// Verifies that all routes return safe defaults (0 / empty array) when
// the PublishedContent table has not been migrated yet (P2021 scenario).

import { describe, expect, it, vi } from "vitest";
import { getDelegate, safeCount } from "~/lib/prisma-safe";
import type { PrismaClient } from "@prisma/client";

function makePrismaWithoutPublishedContent(): PrismaClient {
  return {} as unknown as PrismaClient;
}

function makePrismaWithPublishedContent(rows: unknown[] = []): PrismaClient {
  const countFn = vi.fn().mockResolvedValue(rows.length);
  const findManyFn = vi.fn().mockResolvedValue(rows);
  return {
    publishedContent: { count: countFn, findMany: findManyFn },
  } as unknown as PrismaClient;
}

// --- safeCount ---

describe("safeCount — publishedContent", () => {
  it("returns 0 when publishedContent delegate is absent", async () => {
    const db = makePrismaWithoutPublishedContent();
    const count = await safeCount(db, "publishedContent", { where: { shopId: "s1", status: "published" } });
    expect(count).toBe(0);
  });

  it("returns actual count when delegate exists", async () => {
    const db = makePrismaWithPublishedContent([{}, {}, {}]);
    const count = await safeCount(db, "publishedContent", { where: { shopId: "s1", status: "published" } });
    expect(count).toBe(3);
  });

  it("never throws when delegate is absent", async () => {
    const db = makePrismaWithoutPublishedContent();
    await expect(safeCount(db, "publishedContent")).resolves.toBe(0);
  });
});

// --- getDelegate for findMany ---

describe("getDelegate — publishedContent", () => {
  it("returns null when table is absent", () => {
    const db = makePrismaWithoutPublishedContent();
    expect(getDelegate(db, "publishedContent")).toBeNull();
  });

  it("returns delegate when table exists", () => {
    const db = makePrismaWithPublishedContent();
    const d = getDelegate(db, "publishedContent");
    expect(d).not.toBeNull();
    expect(typeof d?.findMany).toBe("function");
  });

  it("findMany returns empty array when delegate is absent (fallback pattern)", async () => {
    const db = makePrismaWithoutPublishedContent();
    const d = getDelegate(db, "publishedContent");
    const result = d?.findMany ? await d.findMany({ where: { shopId: "s1" } }) : [];
    expect(result).toEqual([]);
  });

  it("findMany returns rows when delegate exists", async () => {
    const row = { id: "pc1", contentType: "faq_page", resourceTitle: "FAQ", status: "published", publishedAt: new Date() };
    const db = makePrismaWithPublishedContent([row]);
    const d = getDelegate(db, "publishedContent");
    const result = d?.findMany ? await d.findMany({ where: { shopId: "s1" } }) : [];
    expect(result).toHaveLength(1);
    expect((result[0] as typeof row).id).toBe("pc1");
  });
});

// --- Simulation of route fallback logic ---

describe("route fallback simulation", () => {
  it("status/analytics route returns publishedCount=0 when table absent", async () => {
    const db = makePrismaWithoutPublishedContent();
    // simulates: const publishedCount = await safeCount(db, "publishedContent", ...)
    const publishedCount = await safeCount(db, "publishedContent", { where: { shopId: "s1", status: "published" } });
    expect(publishedCount).toBe(0);
  });

  it("onboarding buildInput returns hasPublished=false when table absent", async () => {
    const db = makePrismaWithoutPublishedContent();
    const publishedCount = await safeCount(db, "publishedContent", { where: { shopId: "s1", status: "published" } });
    expect(publishedCount > 0).toBe(false);
  });

  it("library loader returns empty rawPublished when table absent", async () => {
    const db = makePrismaWithoutPublishedContent();
    const d = getDelegate(db, "publishedContent");
    const rawPublished = d?.findMany ? await d.findMany({ where: { shopId: "s1" } }) : [];
    expect(rawPublished).toHaveLength(0);
  });

  it("roi loader returns empty syntheticEvents when table absent", async () => {
    const db = makePrismaWithoutPublishedContent();
    const d = getDelegate(db, "publishedContent");
    const publishedContent = d?.findMany
      ? await d.findMany({ where: { shopId: "s1", status: "published" } })
      : [];
    // syntheticEvents = publishedContent.map(...)
    expect(publishedContent).toHaveLength(0);
  });

  it("publish action rate-limit returns 0 when table absent", async () => {
    const db = makePrismaWithoutPublishedContent();
    const recentPublishCount = await safeCount(db, "publishedContent", {
      where: { shopId: "s1", publishedAt: { gte: new Date(Date.now() - 86_400_000) } },
    });
    // 0 < 10 threshold → no rate-limit block
    expect(recentPublishCount).toBe(0);
  });
});
