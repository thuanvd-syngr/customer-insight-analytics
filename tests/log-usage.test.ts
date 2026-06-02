// Tests for logUsage safe delegate wrapper.
// Uses a mock PrismaClient to verify write/no-op behavior.

import { describe, expect, it, vi } from "vitest";
import { logUsage } from "~/lib/log-usage.server";
import type { PrismaClient } from "@prisma/client";

function makePrisma(withUsageEvent: boolean) {
  const createFn = vi.fn().mockResolvedValue({ id: "evt-1" });
  const mock: unknown = withUsageEvent
    ? { usageEvent: { create: createFn } }
    : {};
  return { prisma: mock as PrismaClient, createFn };
}

describe("logUsage", () => {
  it("calls usageEvent.create when delegate exists", async () => {
    const { prisma, createFn } = makePrisma(true);
    await logUsage(prisma, "shop-1", "insight_run");
    expect(createFn).toHaveBeenCalledOnce();
    expect(createFn.mock.calls[0][0]).toMatchObject({
      data: { shopId: "shop-1", featureId: "insight_run" },
    });
  });

  it("is a no-op when usageEvent delegate is absent", async () => {
    const { prisma, createFn } = makePrisma(false);
    await expect(logUsage(prisma, "shop-1", "insight_run")).resolves.toBeUndefined();
    expect(createFn).not.toHaveBeenCalled();
  });

  it("serializes metadata to JSON", async () => {
    const { prisma, createFn } = makePrisma(true);
    await logUsage(prisma, "shop-1", "copilot_used", { topic: "shipping", confidence: 90 });
    const call = createFn.mock.calls[0][0];
    expect(call.data.metadata).toBe(JSON.stringify({ topic: "shipping", confidence: 90 }));
  });

  it("stores null metadata when not provided", async () => {
    const { prisma, createFn } = makePrisma(true);
    await logUsage(prisma, "shop-1", "faq_generated");
    expect(createFn.mock.calls[0][0].data.metadata).toBeNull();
  });

  it("never throws if create rejects", async () => {
    const mock: unknown = { usageEvent: { create: vi.fn().mockRejectedValue(new Error("DB down")) } };
    await expect(logUsage(mock as PrismaClient, "shop-1", "insight_run")).resolves.toBeUndefined();
  });
});
