import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { cleanupShop } from "~/lib/shop.server";

describe("cleanupShop", () => {
  it("deletes sessions and shop", async () => {
    const db = {
      session: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      shop: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    } as unknown as PrismaClient;
    await expect(cleanupShop(db, "shop.myshopify.com")).resolves.toEqual({
      deletedSessions: 2,
      deletedShops: 1,
    });
    expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { shop: "shop.myshopify.com" } });
    expect(db.shop.deleteMany).toHaveBeenCalledWith({ where: { shopDomain: "shop.myshopify.com" } });
  });
});
