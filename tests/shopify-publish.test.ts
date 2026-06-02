import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  publishGeneratedFaq,
  rollbackGeneratedFaq,
} from "~/lib/shopify-publish.server";

// ─── helpers ─────────────────────────────────────────────────────────────────

type FaqRow = {
  id: string;
  shopId: string;
  productId: string | null;
  groupId: string | null;
  answerHtml: string;
  status: string;
  publishTarget: string | null;
  publishRef: string | null;
  previousHtml: string | null;
  publishedAt: Date | null;
  rolledBackAt: Date | null;
  error: string | null;
};

function makeFaq(overrides: Partial<FaqRow> = {}): FaqRow {
  return {
    id: "faq-1",
    shopId: "shop-1",
    productId: "gid://shopify/Product/1",
    groupId: "size",
    answerHtml: "<p>FAQ content</p>",
    status: "draft",
    publishTarget: null,
    publishRef: null,
    previousHtml: null,
    publishedAt: null,
    rolledBackAt: null,
    error: null,
    ...overrides,
  };
}

function makeDb(faq: FaqRow) {
  const store: FaqRow = { ...faq };
  return {
    generatedFaq: {
      findFirst: vi.fn().mockResolvedValue(store),
      update: vi.fn().mockImplementation(({ data }: { data: Partial<FaqRow> }) => {
        Object.assign(store, data);
        return Promise.resolve(store);
      }),
    },
  };
}

function makeAdmin(responses: { graphql?: unknown } = {}) {
  return {
    graphql: vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue(responses.graphql ?? {}),
    }),
  };
}

// ─── publishGeneratedFaq ─────────────────────────────────────────────────────

describe("publishGeneratedFaq", () => {
  it("publishes via metafield and stores the metafield id", async () => {
    const faq = makeFaq();
    const db = makeDb(faq);
    const admin = makeAdmin({
      graphql: {
        data: {
          metafieldsSet: {
            metafields: [{ id: "gid://shopify/Metafield/99" }],
            userErrors: [],
          },
        },
      },
    });

    const result = await publishGeneratedFaq({
      db: db as never,
      admin,
      shopId: "shop-1",
      faqId: "faq-1",
      target: "metafield",
    });

    expect(result.status).toBe("published");
    expect(result.publishTarget).toBe("metafield");
    expect(result.publishRef).toBe("gid://shopify/Metafield/99");
    expect(result.error).toBeNull();
  });

  it("publishes via faq_block using the same metafield path", async () => {
    const faq = makeFaq();
    const db = makeDb(faq);
    const admin = makeAdmin({
      graphql: {
        data: {
          metafieldsSet: {
            metafields: [{ id: "gid://shopify/Metafield/100" }],
            userErrors: [],
          },
        },
      },
    });

    const result = await publishGeneratedFaq({
      db: db as never,
      admin,
      shopId: "shop-1",
      faqId: "faq-1",
      target: "faq_block",
    });

    expect(result.status).toBe("published");
    expect(result.publishRef).toBe("gid://shopify/Metafield/100");
  });

  it("appends FAQ to product description and stores previousHtml", async () => {
    const faq = makeFaq();
    const db = makeDb(faq);
    // First call: productDescription query; second: productUpdate mutation
    const admin = {
      graphql: vi.fn()
        .mockResolvedValueOnce({ json: vi.fn().mockResolvedValue({ data: { product: { descriptionHtml: "<p>Original</p>" } } }) })
        .mockResolvedValueOnce({ json: vi.fn().mockResolvedValue({ data: { productUpdate: { userErrors: [] } } }) }),
    };

    const result = await publishGeneratedFaq({
      db: db as never,
      admin,
      shopId: "shop-1",
      faqId: "faq-1",
      target: "append_description",
    });

    expect(result.status).toBe("published");
    expect(result.previousHtml).toBe("<p>Original</p>");
    expect(result.publishTarget).toBe("append_description");
  });

  it("stores failure when Shopify returns userErrors", async () => {
    const faq = makeFaq();
    const db = makeDb(faq);
    const admin = makeAdmin({
      graphql: {
        data: {
          metafieldsSet: {
            metafields: [],
            userErrors: [{ message: "Product not found" }],
          },
        },
      },
    });

    const result = await publishGeneratedFaq({
      db: db as never,
      admin,
      shopId: "shop-1",
      faqId: "faq-1",
      target: "metafield",
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Product not found");
  });

  it("stores failure when Shopify returns top-level GraphQL errors", async () => {
    const faq = makeFaq();
    const db = makeDb(faq);
    const admin = makeAdmin({
      graphql: { errors: [{ message: "Access denied" }] },
    });

    const result = await publishGeneratedFaq({
      db: db as never,
      admin,
      shopId: "shop-1",
      faqId: "faq-1",
      target: "metafield",
    });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Access denied");
  });

  it("marks failed immediately when no product is linked", async () => {
    const faq = makeFaq({ productId: null });
    const db = makeDb(faq);
    const admin = makeAdmin();

    const result = await publishGeneratedFaq({
      db: db as never,
      admin,
      shopId: "shop-1",
      faqId: "faq-1",
      target: "metafield",
    });

    expect(result.status).toBe("failed");
    expect(admin.graphql).not.toHaveBeenCalled();
  });

  it("throws when the FAQ record is not found", async () => {
    const db = { generatedFaq: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() } };
    const admin = makeAdmin();

    await expect(
      publishGeneratedFaq({ db: db as never, admin, shopId: "shop-1", faqId: "missing", target: "metafield" }),
    ).rejects.toThrow("FAQ draft not found");
  });
});

// ─── rollbackGeneratedFaq ────────────────────────────────────────────────────

describe("rollbackGeneratedFaq", () => {
  it("deletes the metafield and marks rolled_back", async () => {
    const faq = makeFaq({ status: "published", publishTarget: "metafield", publishRef: "gid://shopify/Metafield/99" });
    const db = makeDb(faq);
    const admin = makeAdmin({
      graphql: { data: { metafieldDelete: { deletedId: "gid://shopify/Metafield/99", userErrors: [] } } },
    });

    const result = await rollbackGeneratedFaq({ db: db as never, admin, shopId: "shop-1", faqId: "faq-1" });

    expect(result.status).toBe("rolled_back");
    expect(result.error).toBeNull();
  });

  it("restores previous description for append_description rollback", async () => {
    const faq = makeFaq({
      status: "published",
      publishTarget: "append_description",
      publishRef: "gid://shopify/Product/1",
      previousHtml: "<p>Original</p>",
    });
    const db = makeDb(faq);
    const admin = makeAdmin({
      graphql: { data: { productUpdate: { userErrors: [] } } },
    });

    const result = await rollbackGeneratedFaq({ db: db as never, admin, shopId: "shop-1", faqId: "faq-1" });

    expect(result.status).toBe("rolled_back");
    const updateCall = (admin.graphql as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(updateCall).toContain("productUpdate");
  });

  it("blocks double-rollback on an already rolled-back FAQ", async () => {
    const faq = makeFaq({ status: "rolled_back", publishTarget: "metafield", publishRef: "gid://shopify/Metafield/99" });
    const db = makeDb(faq);
    const admin = makeAdmin();

    const result = await rollbackGeneratedFaq({ db: db as never, admin, shopId: "shop-1", faqId: "faq-1" });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("published");
    expect(admin.graphql).not.toHaveBeenCalled();
  });

  it("marks failed when Shopify returns userErrors during metafield delete", async () => {
    const faq = makeFaq({ status: "published", publishTarget: "metafield", publishRef: "gid://shopify/Metafield/99" });
    const db = makeDb(faq);
    const admin = makeAdmin({
      graphql: { data: { metafieldDelete: { deletedId: null, userErrors: [{ message: "Metafield not found" }] } } },
    });

    const result = await rollbackGeneratedFaq({ db: db as never, admin, shopId: "shop-1", faqId: "faq-1" });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("Metafield not found");
  });

  it("marks failed when no previousHtml is available for append_description", async () => {
    const faq = makeFaq({ status: "published", publishTarget: "append_description", previousHtml: null });
    const db = makeDb(faq);
    const admin = makeAdmin();

    const result = await rollbackGeneratedFaq({ db: db as never, admin, shopId: "shop-1", faqId: "faq-1" });

    expect(result.status).toBe("failed");
    expect(admin.graphql).not.toHaveBeenCalled();
  });
});

// ─── Idempotency tests ───────────────────────────────────────────────────────

describe("publishGeneratedFaq idempotency", () => {
  it("returns existing state without calling Shopify when FAQ is already published (metafield)", async () => {
    const faq = makeFaq({ status: "published", publishTarget: "metafield", publishRef: "gid://shopify/Metafield/99" });
    const db = makeDb(faq);
    const admin = makeAdmin();

    const result = await publishGeneratedFaq({
      db: db as never,
      admin,
      shopId: "shop-1",
      faqId: "faq-1",
      target: "metafield",
    });

    expect(result.status).toBe("published");
    expect(admin.graphql).not.toHaveBeenCalled();
    expect(db.generatedFaq.update).not.toHaveBeenCalled();
  });

  it("returns existing state without duplicating content when FAQ is already published (append_description)", async () => {
    const faq = makeFaq({
      status: "published",
      publishTarget: "append_description",
      publishRef: "gid://shopify/Product/1",
      previousHtml: "<p>Original</p>",
    });
    const db = makeDb(faq);
    const admin = makeAdmin();

    const result = await publishGeneratedFaq({
      db: db as never,
      admin,
      shopId: "shop-1",
      faqId: "faq-1",
      target: "append_description",
    });

    // Must NOT call Shopify (would duplicate the appended FAQ) and must NOT update DB
    expect(admin.graphql).not.toHaveBeenCalled();
    expect(db.generatedFaq.update).not.toHaveBeenCalled();
    expect(result.status).toBe("published");
  });

  it("rollback after a double-publish attempt only removes content once (safe)", async () => {
    const faq = makeFaq({
      status: "published",
      publishTarget: "append_description",
      publishRef: "gid://shopify/Product/1",
      previousHtml: "<p>Original</p>",
    });
    const db = makeDb(faq);
    const admin = makeAdmin({
      graphql: { data: { productUpdate: { userErrors: [] } } },
    });

    const result = await rollbackGeneratedFaq({ db: db as never, admin, shopId: "shop-1", faqId: "faq-1" });

    expect(result.status).toBe("rolled_back");
    // Only one Shopify call (restore), not two
    expect((admin.graphql as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});
