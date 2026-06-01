import type { PrismaClient } from "@prisma/client";

import type { PlanId } from "./plans";
import type { UsageSnapshot } from "./gating";

export type UsageMetric = "messages" | "analyses" | "ai_summaries";

export function monthPeriod(date: Date): string {
  return date.toISOString().slice(0, 7);
}

export function isoWeekPeriod(date: Date): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  utc.setUTCDate(utc.getUTCDate() + 4 - (utc.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export async function incrementUsage(
  db: PrismaClient,
  shopId: string,
  metric: UsageMetric,
  period: string,
  by = 1,
): Promise<number> {
  const row = await db.usageCounter.upsert({
    where: { shopId_metric_period: { shopId, metric, period } },
    update: { count: { increment: by } },
    create: { shopId, metric, period, count: by },
  });
  return row.count;
}

export async function getUsage(
  db: PrismaClient,
  shopId: string,
  metric: UsageMetric,
  period: string,
): Promise<number> {
  const row = await db.usageCounter.findUnique({
    where: { shopId_metric_period: { shopId, metric, period } },
  });
  return row?.count ?? 0;
}

export async function getUsageSnapshot(
  db: PrismaClient,
  shopId: string,
  plan: PlanId,
  now: Date,
): Promise<UsageSnapshot> {
  const month = monthPeriod(now);
  const week = isoWeekPeriod(now);
  const [messagesThisMonth, analysesThisWeek, aiSummariesThisMonth] =
    await Promise.all([
      getUsage(db, shopId, "messages", month),
      getUsage(db, shopId, "analyses", week),
      getUsage(db, shopId, "ai_summaries", month),
    ]);

  return { plan, messagesThisMonth, analysesThisWeek, aiSummariesThisMonth };
}
