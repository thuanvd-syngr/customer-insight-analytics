import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { incrementUsage, isoWeekPeriod, monthPeriod } from "~/lib/billing";

describe("usage", () => {
  it("formats periods", () => {
    const now = new Date("2026-06-01T00:00:00Z");
    expect(monthPeriod(now)).toBe("2026-06");
    expect(isoWeekPeriod(now)).toBe("2026-W23");
  });

  it("increments usage with prisma upsert", async () => {
    const db = {
      usageCounter: {
        upsert: vi.fn().mockResolvedValue({ count: 4 }),
      },
    } as unknown as PrismaClient;
    await expect(incrementUsage(db, "shop_1", "messages", "2026-06", 2)).resolves.toBe(4);
    expect(db.usageCounter.upsert).toHaveBeenCalled();
  });
});
