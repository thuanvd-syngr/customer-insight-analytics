import type { InsightRun, PrismaClient, Shop } from "@prisma/client";

import { normalizeInsightResult, type InsightResult } from "~/lib/types";
import type { PlanId } from "~/lib/billing/plans";

// Central data-access for the Shop aggregate and its insight runs.
// Routes, the uninstall webhook, and tests all depend on these signatures.
// Functions take a `db` client so they can be unit-tested with a fake.

export async function ensureShop(
  db: PrismaClient,
  shopDomain: string,
): Promise<Shop> {
  return db.shop.upsert({
    where: { shopDomain },
    update: { uninstalledAt: null },
    create: { shopDomain },
  });
}

export async function getShopByDomain(
  db: PrismaClient,
  shopDomain: string,
): Promise<Shop | null> {
  return db.shop.findUnique({ where: { shopDomain } });
}

export async function setShopPlan(
  db: PrismaClient,
  shopDomain: string,
  plan: PlanId,
): Promise<Shop> {
  return db.shop.update({ where: { shopDomain }, data: { plan } });
}

export async function markOnboarded(
  db: PrismaClient,
  shopId: string,
): Promise<void> {
  await db.shop.update({
    where: { id: shopId },
    data: { onboardedAt: new Date() },
  });
}

export async function getLatestRun(
  db: PrismaClient,
  shopId: string,
): Promise<InsightRun | null> {
  return db.insightRun.findFirst({
    where: { shopId, status: "completed" },
    orderBy: { createdAt: "desc" },
  });
}

export async function getRecentRuns(
  db: PrismaClient,
  shopId: string,
  take = 10,
): Promise<InsightRun[]> {
  return db.insightRun.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/** Parse the JSON snapshot stored on a run back into an InsightResult. */
export function parseRun(run: InsightRun | null): InsightResult | null {
  if (!run?.summaryJson) return null;
  try {
    return normalizeInsightResult(JSON.parse(run.summaryJson) as Partial<InsightResult>);
  } catch {
    return null;
  }
}

/**
 * Persist a completed analysis: the run snapshot plus normalized child
 * findings used by the detail pages (/app/insights, /app/products).
 */
export async function saveInsightRun(
  db: PrismaClient,
  shopId: string,
  result: InsightResult,
  windowDays: number = result.windowDays,
): Promise<InsightRun> {
  const run = await db.insightRun.create({
    data: {
      shopId,
      status: "completed",
      messageCount: result.messageCount,
      insightScore: result.insightScore,
      windowDays,
      summaryJson: JSON.stringify(result),
      finishedAt: new Date(),
    },
  });

  if (result.keywordGroups.length > 0) {
    await db.keywordFinding.createMany({
      data: result.keywordGroups.map((g) => ({
        runId: run.id,
        shopId,
        groupId: g.groupId,
        keyword: g.keywords[0]?.keyword ?? g.label,
        count: g.count,
        trend7: g.trend7,
        trend30: g.trend30,
        exampleQuote: g.exampleQuote ?? null,
      })),
    });
  }

  if (result.productConfusion.length > 0) {
    await db.productFinding.createMany({
      data: result.productConfusion.map((p) => ({
        runId: run.id,
        shopId,
        productId: p.productId,
        productTitle: p.productTitle,
        mentionCount: p.mentionCount,
        confusionScore: p.confusionScore,
        topGroups: JSON.stringify(p.topGroups),
        exampleQuote: p.exampleQuote ?? null,
      })),
    });
  }

  if (result.faqOpportunities.length > 0) {
    await db.faqOpportunity.createMany({
      data: result.faqOpportunities.map((f) => ({
        runId: run.id,
        shopId,
        groupId: f.groupId,
        question: f.question,
        rationale: f.rationale ?? null,
        frequency: f.frequency,
        hasContent: f.hasContent,
        priority: f.priority,
        productId: f.productId ?? null,
      })),
    });
  }

  return run;
}

/**
 * Remove all data for a shop. Called by the app/uninstalled webhook.
 * Deletes offline/online sessions (not FK-linked to Shop) and the Shop row
 * (cascades to messages, runs, findings, reports, settings, usage).
 */
export async function cleanupShop(
  db: PrismaClient,
  shopDomain: string,
): Promise<{ deletedSessions: number; deletedShops: number }> {
  const sessions = await db.session.deleteMany({
    where: { shop: shopDomain },
  });
  const shops = await db.shop.deleteMany({ where: { shopDomain } });
  return { deletedSessions: sessions.count, deletedShops: shops.count };
}
