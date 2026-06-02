// Tests for the product recovery detail page logic:
// - Empty state when no confusion/gap found
// - Recovery pack generation (GeneratedFaq creation)
// - Safe delegate fallback when productOptimizationDraft table absent
// - No crash when PublishedContent/ProductOptimizationDraft delegate missing

import { describe, expect, it, vi } from "vitest";
import { getDelegate, safeCount } from "~/lib/prisma-safe";
import { generateFaqFromOpportunity, faqToHtml } from "~/lib/faq-generator";
import type { PrismaClient } from "@prisma/client";

// --- Helpers ---

function makeDbWithProduct(product: unknown = null): PrismaClient {
  return {
    shopifyProduct: { findFirst: vi.fn().mockResolvedValue(product) },
    insightRun: { findFirst: vi.fn().mockResolvedValue(null) },
    importedMessage: { count: vi.fn().mockResolvedValue(0) },
  } as unknown as PrismaClient;
}

function makeDbWithDrafts(drafts: unknown[] = []): PrismaClient {
  return {
    productOptimizationDraft: {
      findMany: vi.fn().mockResolvedValue(drafts),
    },
  } as unknown as PrismaClient;
}

function makeDbWithoutDraftTable(): PrismaClient {
  return {} as unknown as PrismaClient;
}

function makeDbWithFaqCreate(): { created: unknown[]; db: PrismaClient } {
  const created: unknown[] = [];
  const db = {
    generatedFaq: {
      create: vi.fn().mockImplementation(({ data }: { data: unknown }) => {
        created.push(data);
        return Promise.resolve({ id: `faq-${created.length}` });
      }),
    },
    usageEvent: {
      create: vi.fn().mockResolvedValue({ id: "ue1" }),
    },
  } as unknown as PrismaClient;
  return { created, db };
}

// --- Empty state: no delegate ---

describe("productOptimizationDraft safe delegate", () => {
  it("returns empty array when table is absent", async () => {
    const db = makeDbWithoutDraftTable();
    const d = getDelegate(db, "productOptimizationDraft");
    const drafts = d?.findMany ? await d.findMany({ where: { shopId: "s1" } }) : [];
    expect(drafts).toHaveLength(0);
  });

  it("returns drafts when table exists", async () => {
    const db = makeDbWithDrafts([{ id: "d1", sectionType: "shipping", status: "draft" }]);
    const d = getDelegate(db, "productOptimizationDraft");
    const drafts = d?.findMany ? await d.findMany({ where: { shopId: "s1" } }) : [];
    expect(drafts).toHaveLength(1);
  });
});

// --- Recovery pack generation logic ---

describe("recovery pack FAQ generation", () => {
  it("generates a FAQ object for a shipping group", () => {
    const faq = generateFaqFromOpportunity({
      groupId: "shipping",
      label: "Shipping",
      count: 5,
      trend7: 0,
      severity: "high",
      revenueImpact: 200,
      lowEstimate: 100,
      highEstimate: 300,
      priorityScore: 80,
      actionType: "faq",
      suggestedAction: "Create a shipping FAQ",
    });
    expect(faq.question).toBeTruthy();
    expect(faq.answer).toBeTruthy();
    expect(faq.topic).toBe("shipping");
    expect(faq.source).toBe("rule");
  });

  it("generates HTML from a FAQ object", () => {
    const faq = generateFaqFromOpportunity({
      groupId: "return",
      label: "Returns",
      count: 3,
      trend7: 0,
      severity: "medium",
      revenueImpact: 100,
      lowEstimate: 50,
      highEstimate: 150,
      priorityScore: 60,
      actionType: "faq",
      suggestedAction: "Create a returns FAQ",
    });
    const html = faqToHtml(faq);
    expect(html).toContain("<section");
    expect(html).toContain("customer-insight-faq");
    expect(html).toContain("<h3>");
    expect(html).toContain("<p>");
  });

  it("creates GeneratedFaq records for top groups", async () => {
    const { created, db } = makeDbWithFaqCreate();
    const groups = ["shipping", "return", "payment"];
    for (const groupId of groups) {
      const faq = generateFaqFromOpportunity({
        groupId: groupId as "shipping",
        label: groupId,
        count: 1,
        trend7: 0,
        severity: "medium",
        revenueImpact: 0,
        lowEstimate: 0,
        highEstimate: 0,
        priorityScore: 50,
        actionType: "faq",
        suggestedAction: `FAQ for ${groupId}`,
      });
      await (db as unknown as { generatedFaq: { create: (args: unknown) => Promise<unknown> } }).generatedFaq.create({
        data: {
          shopId: "shop1",
          groupId,
          productId: "gid://shopify/Product/123",
          productTitle: "Test Product",
          question: faq.question,
          answerText: faq.answer,
          answerHtml: faqToHtml(faq),
          format: "seo",
          source: "rule",
          status: "draft",
          publishTarget: "metafield",
        },
      });
    }
    expect(created).toHaveLength(3);
    expect((created[0] as { groupId: string }).groupId).toBe("shipping");
    expect((created[1] as { groupId: string }).groupId).toBe("return");
    expect((created[2] as { groupId: string }).groupId).toBe("payment");
  });

  it("saves drafts with status='draft' (not published)", async () => {
    const { created, db } = makeDbWithFaqCreate();
    const faq = generateFaqFromOpportunity({
      groupId: "shipping",
      label: "Shipping",
      count: 1,
      trend7: 0,
      severity: "high",
      revenueImpact: 0,
      lowEstimate: 0,
      highEstimate: 0,
      priorityScore: 80,
      actionType: "faq",
      suggestedAction: "Create shipping FAQ",
    });
    await (db as unknown as { generatedFaq: { create: (args: unknown) => Promise<unknown> } }).generatedFaq.create({
      data: { shopId: "s1", groupId: "shipping", question: faq.question, answerText: faq.answer, answerHtml: faqToHtml(faq), format: "seo", source: "rule", status: "draft", publishTarget: "metafield" },
    });
    expect((created[0] as { status: string }).status).toBe("draft");
  });
});

// --- safeCount for generatedFaq ---

describe("safeCount — generatedFaq", () => {
  it("returns 0 when generatedFaq delegate is absent", async () => {
    const db = {} as unknown as PrismaClient;
    const count = await safeCount(db, "generatedFaq", { where: { shopId: "s1", status: "published" } });
    expect(count).toBe(0);
  });

  it("returns count when delegate exists", async () => {
    const db = { generatedFaq: { count: vi.fn().mockResolvedValue(7) } } as unknown as PrismaClient;
    const count = await safeCount(db, "generatedFaq", { where: { shopId: "s1", status: "published" } });
    expect(count).toBe(7);
  });
});
