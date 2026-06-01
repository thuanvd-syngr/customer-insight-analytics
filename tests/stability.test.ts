import { describe, expect, it, vi } from "vitest";

import { getUsageSnapshot } from "~/lib/billing";
import { getDelegate, safeCount } from "~/lib/prisma-safe";
import { syncShopifyData, type AdminLike } from "~/lib/shopify-data.server";
import { productSyncStatusText } from "~/lib/sync-status";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

function dbWithProductColumns(columns: string[]) {
  const upsert = vi.fn().mockResolvedValue({});
  return {
    shopifyProduct: { upsert },
    shopifyOrder: { upsert: vi.fn().mockResolvedValue({}) },
    importedMessage: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const query = String(strings);
      if (query.includes("_prisma_migrations")) {
        return [{ migration_name: "20260601090000_real_shopify_data_engine", finished_at: new Date() }];
      }
      return [
        "id",
        "shopId",
        "externalId",
        "title",
        "handle",
        "description",
        "rawJson",
        "syncedAt",
        ...columns,
      ].map((column_name) => ({ column_name }));
    }),
  } as any;
}

function productAdmin(): AdminLike {
  return {
    graphql: vi.fn(async (query: string) => {
      if (query.includes("products(")) {
        return jsonResponse({
          data: {
            products: {
              nodes: [{
                id: "gid://shopify/Product/1",
                title: "Hoodie",
                handle: "hoodie",
                descriptionHtml: "Soft cotton hoodie",
                tags: ["winter"],
                productType: "Apparel",
                collections: { nodes: [{ id: "gid://shopify/Collection/1", title: "Clothing" }] },
              }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        });
      }
      return jsonResponse({ data: { orders: { nodes: [], pageInfo: { hasNextPage: false } } } });
    }),
  };
}

describe("stability fallbacks", () => {
  it("Shopify sync continues without protected customer data", async () => {
    const db = {
      shopifyProduct: {
        upsert: vi.fn().mockResolvedValue({}),
      },
      shopifyOrder: {
        upsert: vi.fn().mockResolvedValue({}),
      },
      importedMessage: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
    } as any;
    const admin: AdminLike = {
      graphql: vi.fn(async (query: string) => {
        if (query.includes("products(")) {
          return jsonResponse({
            data: {
              products: {
                nodes: [{
                  id: "gid://shopify/Product/1",
                  title: "Hoodie",
                  handle: "hoodie",
                  descriptionHtml: "Soft cotton hoodie",
                  tags: ["winter"],
                  productType: "Apparel",
                  collections: { nodes: [{ id: "gid://shopify/Collection/1", title: "Clothing" }] },
                }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          });
        }
        if (query.includes("orders(")) {
          return jsonResponse({ errors: [{ message: "This app is not approved to access protected customer data." }] });
        }
        throw new Error("Unexpected query");
      }),
    };

    const result = await syncShopifyData(db, "shop_1", admin);

    expect(result.products.ok).toBe(true);
    expect(result.products.count).toBe(1);
    expect(result.orders.ok).toBe(false);
    expect(result.orders.skipped).toBe(true);
    expect(result.customers.skipped).toBe(true);
    expect(String((admin.graphql as any).mock.calls.flat())).not.toContain("customers(");
    expect(String((admin.graphql as any).mock.calls.flat())).toContain("descriptionHtml");
  });

  it("marks products failed instead of skipped when Shopify API errors", async () => {
    const db = {
      shopifyProduct: { upsert: vi.fn() },
      importedMessage: { findFirst: vi.fn(), create: vi.fn() },
    } as any;
    const admin: AdminLike = {
      graphql: vi.fn(async (query: string) => {
        if (query.includes("products(")) {
          return jsonResponse({ errors: [{ message: "Field 'description' does not exist on type Product" }] });
        }
        return jsonResponse({ data: { orders: { nodes: [], pageInfo: { hasNextPage: false } } } });
      }),
    };

    const result = await syncShopifyData(db, "shop_1", admin);

    expect(result.products.ok).toBe(false);
    expect(result.products.skipped).toBe(false);
    expect(result.products.error).toContain("description");
  });

  it("marks products failed instead of skipped when Prisma product delegate is missing", async () => {
    const db = {
      importedMessage: { findFirst: vi.fn(), create: vi.fn() },
    } as any;
    const admin: AdminLike = {
      graphql: vi.fn(async (query: string) => {
        if (query.includes("products(")) {
          return jsonResponse({
            data: {
              products: {
                nodes: [{ id: "gid://shopify/Product/1", title: "Hoodie", descriptionHtml: "" }],
                pageInfo: { hasNextPage: false },
              },
            },
          });
        }
        return jsonResponse({ data: { orders: { nodes: [], pageInfo: { hasNextPage: false } } } });
      }),
    };

    const result = await syncShopifyData(db, "shop_1", admin);

    expect(result.products.ok).toBe(false);
    expect(result.products.skipped).toBe(false);
    expect(result.products.error).toBe("Product database model unavailable");
    expect(productSyncStatusText(result.products)).toBe("Failed: Product database model unavailable");
  });

  it.each([
    ["tags", ["productType", "collections"]],
    ["productType", ["tags", "collections"]],
    ["collections", ["tags", "productType"]],
  ])("imports products when %s column is missing", async (missingColumn, columns) => {
    const db = dbWithProductColumns(columns);
    const result = await syncShopifyData(db, "shop_1", productAdmin());
    const upsertArgs = db.shopifyProduct.upsert.mock.calls[0]?.[0];

    expect(result.products.ok).toBe(true);
    expect(result.products.count).toBe(1);
    expect(upsertArgs.update.title).toBe("Hoodie");
    expect(upsertArgs.update).not.toHaveProperty(missingColumn);
    expect(upsertArgs.create).not.toHaveProperty(missingColumn);
  });

  it("returns safe fallbacks when Prisma delegates are missing", async () => {
    const db = {} as any;

    expect(getDelegate(db, "weeklyEmail")).toBeNull();
    await expect(safeCount(db, "weeklyEmail", {})).resolves.toBe(0);
    await expect(getUsageSnapshot(db, "shop_1", "free", new Date("2026-06-01T00:00:00Z"))).resolves.toMatchObject({
      messagesThisMonth: 0,
      analysesThisWeek: 0,
      aiSummariesThisMonth: 0,
    });
  });
});
