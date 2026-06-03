import { afterEach, describe, expect, it, vi } from "vitest";

import { getUsageSnapshot } from "~/lib/billing";
import { getDelegate, safeCount } from "~/lib/prisma-safe";
import { syncShopifyData, type AdminLike } from "~/lib/shopify-data.server";
import { orderSyncStatusText, productSyncStatusText } from "~/lib/sync-status";

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
                vendor: "IndexBoost",
                updatedAt: "2026-06-01T00:00:00Z",
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

afterEach(() => {
  vi.unstubAllGlobals();
});

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
                  vendor: "IndexBoost",
                  updatedAt: "2026-06-01T00:00:00Z",
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
    ["tags", ["vendor", "productType", "shopifyUpdatedAt", "collections"]],
    ["vendor", ["tags", "productType", "shopifyUpdatedAt", "collections"]],
    ["productType", ["tags", "vendor", "shopifyUpdatedAt", "collections"]],
    ["shopifyUpdatedAt", ["tags", "vendor", "productType", "collections"]],
    ["collections", ["tags", "vendor", "productType", "shopifyUpdatedAt"]],
  ])("imports products when %s column is missing", async (missingColumn, columns) => {
    const db = dbWithProductColumns(columns);
    const result = await syncShopifyData(db, "shop_1", productAdmin());
    const upsertArgs = db.shopifyProduct.upsert.mock.calls[0]?.[0];

    expect(result.products.ok).toBe(true);
    expect(result.products.count).toBe(1);
    expect(upsertArgs.update.title).toBe("Hoodie");
    if (missingColumn !== "vendor") expect(upsertArgs.update.vendor).toBe("IndexBoost");
    if (missingColumn !== "shopifyUpdatedAt") expect(upsertArgs.update.shopifyUpdatedAt).toEqual(new Date("2026-06-01T00:00:00Z"));
    expect(upsertArgs.update).not.toHaveProperty(missingColumn);
    expect(upsertArgs.create).not.toHaveProperty(missingColumn);
  });

  it("shows a clear order reason when read_orders is missing", async () => {
    const db = dbWithProductColumns(["tags", "vendor", "productType", "shopifyUpdatedAt", "collections"]);
    const result = await syncShopifyData(db, "shop_1", productAdmin(), { grantedScopes: "read_products,read_content" });

    expect(result.orders.skipped).toBe(true);
    expect(result.orders.reason).toContain("re-installing the app");
    expect(orderSyncStatusText(result.orders)).toContain("re-installing the app");
    expect(productSyncStatusText(result.products)).toBe("Synced 1 products");
  });

  it("treats write_products as enough product read access during sync", async () => {
    const db = dbWithProductColumns(["tags", "vendor", "productType", "shopifyUpdatedAt", "collections"]);
    const result = await syncShopifyData(db, "shop_1", productAdmin(), { grantedScopes: "write_products,read_orders" });

    expect(result.products.ok).toBe(true);
    expect(result.products.count).toBe(1);
    expect(result.orders.ok).toBe(true);
  });

  it("falls back to REST product sync when Shopify Admin GraphQL is forbidden", async () => {
    const db = dbWithProductColumns(["tags", "vendor", "productType", "shopifyUpdatedAt", "collections"]);
    const admin: AdminLike = {
      graphql: vi.fn(async (query: string) => {
        if (query.includes("products(")) {
          throw new Response(
            JSON.stringify({ errors: { networkStatusCode: 403, message: "GraphQL Client: Forbidden", response: {} } }),
            { status: 403 },
          );
        }
        return jsonResponse({ data: { orders: { nodes: [], pageInfo: { hasNextPage: false } } } });
      }),
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      products: [{
        id: 123,
        admin_graphql_api_id: "gid://shopify/Product/123",
        title: "REST Hoodie",
        handle: "rest-hoodie",
        vendor: "IndexBoost",
        updated_at: "2026-06-01T00:00:00Z",
        body_html: "Loaded from REST",
        tags: "winter, featured",
        product_type: "Apparel",
      }],
    })));

    const result = await syncShopifyData(db, "shop_1", admin, {
      shopDomain: "test.myshopify.com",
      accessToken: "shpat_test",
      grantedScopes: "write_products,read_orders",
    });

    expect(result.products.ok).toBe(true);
    expect(result.products.count).toBe(1);
    expect(db.shopifyProduct.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { shopId_externalId: { shopId: "shop_1", externalId: "gid://shopify/Product/123" } },
    }));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "test.myshopify.com" }),
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Shopify-Access-Token": "shpat_test" }),
      }),
    );
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
