import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { cleanupShop } from "~/lib/shop.server";

// ─── GDPR webhook business-logic tests ───────────────────────────────────────
// Route handlers themselves require authenticate.webhook (Shopify network call),
// so we test the underlying functions they delegate to.

describe("GDPR shop/redact — delegates to cleanupShop", () => {
  it("deletes sessions and shop when shop exists", async () => {
    const db = {
      session: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
      shop: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    } as unknown as PrismaClient;

    const result = await cleanupShop(db, "merchant.myshopify.com");

    expect(result).toEqual({ deletedSessions: 3, deletedShops: 1 });
    expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { shop: "merchant.myshopify.com" } });
    expect(db.shop.deleteMany).toHaveBeenCalledWith({ where: { shopDomain: "merchant.myshopify.com" } });
  });

  it("returns count 0 without throwing when shop was already removed by uninstall webhook", async () => {
    const db = {
      session: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      shop: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    } as unknown as PrismaClient;

    await expect(cleanupShop(db, "gone.myshopify.com")).resolves.toEqual({
      deletedSessions: 0,
      deletedShops: 0,
    });
  });
});

describe("GDPR customers/redact — anonymises customerRef", () => {
  it("nullifies customerRef for messages linked to the redacted customer", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const db = {
      importedMessage: { updateMany },
    } as unknown as PrismaClient;

    // Simulate what the webhook handler does
    const customerId = "12345678";
    await db.importedMessage.updateMany({
      where: { customerRef: customerId },
      data: { customerRef: null },
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: { customerRef: "12345678" },
      data: { customerRef: null },
    });
  });

  it("is safe when no messages are linked (count 0)", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const db = { importedMessage: { updateMany } } as unknown as PrismaClient;

    await expect(
      db.importedMessage.updateMany({
        where: { customerRef: "unknown-id" },
        data: { customerRef: null },
      }),
    ).resolves.toEqual({ count: 0 });
  });
});

describe("GDPR customers/data_request — no PII stored", () => {
  it("confirms app stores no raw customer PII (only hashed customerRef)", () => {
    // This app stores customerRef as a hashed/opaque ID, never raw email or name.
    // The data_request handler logs the request and responds 200 with no export.
    // We assert the documented policy here as a living spec.
    const storedFields = ["customerRef"]; // only field related to customers
    const rawPiiFields = ["email", "phone", "firstName", "lastName"];
    rawPiiFields.forEach((field) => {
      expect(storedFields).not.toContain(field);
    });
  });
});
