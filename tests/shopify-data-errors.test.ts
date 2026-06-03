import { describe, expect, it, vi } from "vitest";

import type { AdminLike } from "~/lib/shopify-data.server";
import { fetchOrders, fetchProducts, fetchOrderSnapshots } from "~/lib/shopify-data.server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdmin(body: unknown, status = 200): AdminLike {
  return {
    graphql: vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue(body),
      status,
    } as unknown as Response),
  };
}

function makeProductsBody(nodes: Array<{ id: string; title: string; handle?: string | null }> = []) {
  return {
    data: {
      products: {
        nodes: nodes.map((n) => ({
          id: n.id,
          title: n.title,
          handle: n.handle ?? null,
          vendor: null,
          updatedAt: null,
          descriptionHtml: "",
          tags: [],
          productType: null,
          collections: { nodes: [] },
        })),
        pageInfo: { hasNextPage: false },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Top-level GraphQL errors are surfaced with context
// ---------------------------------------------------------------------------

describe("GraphQL top-level errors are surfaced with context", () => {
  it("fetchProducts throws with the exact GraphQL error message", async () => {
    const admin = makeAdmin({
      errors: [{ message: "Field 'descriptionHtml' doesn't exist on type 'Product'" }],
    });
    await expect(fetchProducts(admin)).rejects.toThrow(
      "Field 'descriptionHtml' doesn't exist on type 'Product'",
    );
  });

  it("fetchOrders throws with the exact GraphQL error message", async () => {
    const admin = makeAdmin({
      errors: [{ message: "Access denied for orders field" }],
    });
    await expect(fetchOrders(admin)).rejects.toThrow("Access denied for orders field");
  });

  it("fetchOrderSnapshots throws with the exact GraphQL error message", async () => {
    const admin = makeAdmin({
      errors: [{ message: "Throttled: query cost exceeds budget" }],
    });
    await expect(fetchOrderSnapshots(admin)).rejects.toThrow("Throttled");
  });

  it("includes the error extension code in the thrown message when present", async () => {
    const admin = makeAdmin({
      errors: [{ message: "Not authorized", extensions: { code: "UNAUTHORIZED" } }],
    });
    const err = await fetchProducts(admin).catch((e: unknown) => e);
    expect((err as Error).message).toContain("UNAUTHORIZED");
    expect((err as Error).message).toContain("Not authorized");
  });

  it("joins multiple top-level errors with semicolons", async () => {
    const admin = makeAdmin({
      errors: [
        { message: "First error" },
        { message: "Second error" },
      ],
    });
    const err = await fetchProducts(admin).catch((e: unknown) => e);
    expect((err as Error).message).toContain("First error");
    expect((err as Error).message).toContain("Second error");
  });

  it("includes the operation name so Cloud Run logs show which query failed", async () => {
    const admin = makeAdmin({
      errors: [{ message: "Connection timed out" }],
    });
    const err = await fetchProducts(admin).catch((e: unknown) => e);
    // Operation name "Products" must appear — helps triage in Cloud Run
    expect((err as Error).message).toContain("Products");
  });

  it("includes the operation name for order errors", async () => {
    const admin = makeAdmin({
      errors: [{ message: "Connection timed out" }],
    });
    const err = await fetchOrders(admin).catch((e: unknown) => e);
    expect((err as Error).message).toContain("Orders");
  });
});

// ---------------------------------------------------------------------------
// Success path — no errors when response is clean
// ---------------------------------------------------------------------------

describe("no error when GraphQL response is clean", () => {
  it("fetchProducts returns mapped products when there are no errors", async () => {
    const admin = makeAdmin(
      makeProductsBody([{ id: "gid://shopify/Product/1", title: "Test Product", handle: "test-product" }]),
    );
    const products = await fetchProducts(admin, { first: 1 });
    expect(products).toHaveLength(1);
    expect(products[0].title).toBe("Test Product");
    expect(products[0].handle).toBe("test-product");
  });

  it("fetchOrders returns empty array for a shop with no order notes", async () => {
    const admin = makeAdmin({
      data: { orders: { nodes: [{ id: "gid://shopify/Order/1", name: "#1001", note: null, tags: [], createdAt: "2026-01-01T00:00:00Z", processedAt: null }] } },
    });
    const messages = await fetchOrders(admin, { first: 1 });
    // note is null, so no messages
    expect(messages).toHaveLength(0);
  });

  it("fetchOrders maps order notes to NormalizedMessage entries", async () => {
    const admin = makeAdmin({
      data: {
        orders: {
          nodes: [{
            id: "gid://shopify/Order/42",
            name: "#1042",
            note: "Please gift wrap",
            tags: [],
            createdAt: "2026-01-15T10:00:00Z",
            processedAt: null,
          }],
        },
      },
    });
    const messages = await fetchOrders(admin, { first: 1 });
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("Please gift wrap");
    expect(messages[0].source).toBe("order_note");
  });
});

// ---------------------------------------------------------------------------
// errorMessage fallback — non-Error exceptions do not produce "Shopify sync failed."
// ---------------------------------------------------------------------------

describe("non-Error exceptions propagate with meaningful content", () => {
  it("a plain object rejection from admin.graphql is normalized with operation context", async () => {
    const admin: AdminLike = {
      graphql: vi.fn().mockRejectedValue({ code: "ECONNREFUSED", port: 5432 }),
    };
    const err = await fetchProducts(admin).catch((e: unknown) => e);
    expect(err).toBeDefined();
    expect((err as Error).message).toContain("Products");
    expect((err as Error).message).toContain("ECONNREFUSED");
  });

  it("a thrown Shopify HTTP Response is surfaced with status and body", async () => {
    const admin: AdminLike = {
      graphql: vi.fn().mockRejectedValue(new Response(
        JSON.stringify({ errors: [{ message: "Access token is invalid" }] }),
        { status: 401, statusText: "Unauthorized" },
      )),
    };
    const err = await fetchProducts(admin).catch((e: unknown) => e);

    expect((err as Error).message).toContain("Products");
    expect((err as Error).message).toContain("HTTP 401");
    expect((err as Error).message).toContain("Access token is invalid");
  });

  it("a thrown empty Headers object does not display as raw size JSON", async () => {
    const admin: AdminLike = {
      graphql: vi.fn().mockRejectedValue(new Headers()),
    };
    const err = await fetchProducts(admin).catch((e: unknown) => e);

    expect((err as Error).message).toContain("Products");
    expect((err as Error).message).toContain("empty response headers");
    expect((err as Error).message).not.toContain('"size":0');
  });
});
