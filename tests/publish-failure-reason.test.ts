import { describe, expect, it, vi } from "vitest";

import { publishFaqAsShopifyPage } from "~/lib/publish/shopify-publisher.server";

describe("publish failure reason", () => {
  it("captures exact Shopify GraphQL userErrors for failed page publish", async () => {
    const created: Array<Record<string, unknown>> = [];
    const db = {
      publishedContent: {
        create: vi.fn().mockImplementation(({ data }) => {
          created.push(data);
          return Promise.resolve({ id: "pc1" });
        }),
      },
    };
    const admin = {
      graphql: vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
          data: {
            pageCreate: {
              page: null,
              userErrors: [{ message: "Online Store channel is not available for this shop" }],
            },
          },
        }),
      }),
    };

    const result = await publishFaqAsShopifyPage({
      db: db as never,
      admin,
      shopId: "shop1",
      contentType: "shipping_page",
      faqs: [{ question: "How long does shipping take?", answer: "3-5 days." }],
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Online Store channel is not available for this shop");
    expect(created[0]?.status).toBe("failed");
    expect(created[0]?.error).toBe("Online Store channel is not available for this shop");
  });
});
