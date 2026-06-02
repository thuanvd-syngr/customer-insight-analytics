import type { PrismaClient } from "@prisma/client";

import type { AdminLike } from "~/lib/shopify-data.server";
import type { PageContentType } from "./content-templates";
import { buildArticleContent, buildPageContent } from "./content-templates";
import type { FaqItem } from "./content-templates";

export type { FaqItem, PageContentType };

type PublishedContentRow = {
  id: string;
  shopId: string;
  contentType: string;
  resourceId: string | null;
  resourceTitle: string;
  sourceId: string | null;
  status: string;
  error: string | null;
  publishedAt: Date | string;
  createdAt: Date | string;
};

type PublishedContentDelegate = {
  create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
  update: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ id: string }>;
  findMany: (args: Record<string, unknown>) => Promise<PublishedContentRow[]>;
  count: (args: Record<string, unknown>) => Promise<number>;
};

function getModel(db: PrismaClient): PublishedContentDelegate | undefined {
  return (
    db as unknown as { publishedContent?: PublishedContentDelegate }
  ).publishedContent;
}

async function graph<T>(
  admin: AdminLike,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  const body = (await response.json()) as T & { errors?: Array<{ message: string }> };
  if ((body as { errors?: Array<{ message: string }> }).errors?.length) {
    throw new Error(
      ((body as { errors?: Array<{ message: string }> }).errors ?? [])
        .map((e) => e.message)
        .join("; "),
    );
  }
  return body;
}

async function getOrCreateBlog(admin: AdminLike, blogTitle: string): Promise<string> {
  const existing = await graph<{
    data?: { blogs?: { nodes?: Array<{ id: string; title: string }> } };
  }>(admin, `query GetBlogs($first: Int!) { blogs(first: $first) { nodes { id title } } }`, {
    first: 10,
  });
  const found = (existing.data?.blogs?.nodes ?? []).find(
    (b) => b.title.toLowerCase() === blogTitle.toLowerCase(),
  );
  if (found) return found.id;

  const created = await graph<{
    data?: { blogCreate?: { blog?: { id: string }; userErrors?: Array<{ message: string }> } };
  }>(
    admin,
    `mutation BlogCreate($blog: BlogCreateInput!) {
      blogCreate(blog: $blog) { blog { id } userErrors { message } }
    }`,
    { blog: { title: blogTitle } },
  );
  const errors = created.data?.blogCreate?.userErrors ?? [];
  if (errors.length > 0) throw new Error(errors.map((e) => e.message).join("; "));
  const blogId = created.data?.blogCreate?.blog?.id;
  if (!blogId) throw new Error("Failed to create blog.");
  return blogId;
}

async function record(
  db: PrismaClient,
  data: {
    shopId: string;
    contentType: string;
    resourceId: string | null;
    resourceTitle: string;
    sourceId: string | null;
    status: string;
    error: string | null;
  },
): Promise<void> {
  const model = getModel(db);
  if (!model) return;
  await model.create({ data: { ...data, publishedAt: new Date() } });
}

export type PublishResult = {
  ok: boolean;
  resourceId: string | null;
  resourceTitle: string;
  error: string | null;
};

export async function publishFaqAsShopifyPage(input: {
  db: PrismaClient;
  admin: AdminLike;
  shopId: string;
  contentType: PageContentType;
  faqs: FaqItem[];
  sourceId?: string;
}): Promise<PublishResult> {
  const { title, handle, bodyHtml } = buildPageContent(input.contentType, input.faqs);
  try {
    const body = await graph<{
      data?: {
        pageCreate?: {
          page?: { id: string; title: string };
          userErrors?: Array<{ message: string }>;
        };
      };
    }>(
      input.admin,
      `mutation PageCreate($page: PageCreateInput!) {
        pageCreate(page: $page) {
          page { id title }
          userErrors { message }
        }
      }`,
      { page: { title, handle, body: bodyHtml, isPublished: true } },
    );
    const errors = body.data?.pageCreate?.userErrors ?? [];
    if (errors.length > 0) {
      const error = errors.map((e) => e.message).join("; ");
      await record(input.db, {
        shopId: input.shopId,
        contentType: input.contentType,
        resourceId: null,
        resourceTitle: title,
        sourceId: input.sourceId ?? null,
        status: "failed",
        error,
      });
      return { ok: false, resourceId: null, resourceTitle: title, error };
    }
    const resourceId = body.data?.pageCreate?.page?.id ?? null;
    await record(input.db, {
      shopId: input.shopId,
      contentType: input.contentType,
      resourceId,
      resourceTitle: title,
      sourceId: input.sourceId ?? null,
      status: "published",
      error: null,
    });
    return { ok: true, resourceId, resourceTitle: title, error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Shopify page publish failed.";
    await record(input.db, {
      shopId: input.shopId,
      contentType: input.contentType,
      resourceId: null,
      resourceTitle: title,
      sourceId: input.sourceId ?? null,
      status: "failed",
      error,
    });
    return { ok: false, resourceId: null, resourceTitle: title, error };
  }
}

export async function publishFaqAsBlogArticle(input: {
  db: PrismaClient;
  admin: AdminLike;
  shopId: string;
  groupId: string;
  faqs: FaqItem[];
  storeName?: string;
  blogTitle?: string;
  sourceId?: string;
}): Promise<PublishResult> {
  const { title, handle, bodyHtml, summary } = buildArticleContent(
    input.groupId,
    input.faqs,
    input.storeName,
  );
  try {
    const blogTitle = input.blogTitle ?? "Customer Insights";
    const blogId = await getOrCreateBlog(input.admin, blogTitle);
    const body = await graph<{
      data?: {
        articleCreate?: {
          article?: { id: string; title: string };
          userErrors?: Array<{ message: string }>;
        };
      };
    }>(
      input.admin,
      `mutation ArticleCreate($article: ArticleCreateInput!) {
        articleCreate(article: $article) {
          article { id title }
          userErrors { message }
        }
      }`,
      { article: { blogId, title, body: bodyHtml, summary, handle, isPublished: true } },
    );
    const errors = body.data?.articleCreate?.userErrors ?? [];
    if (errors.length > 0) {
      const error = errors.map((e) => e.message).join("; ");
      await record(input.db, {
        shopId: input.shopId,
        contentType: "blog_article",
        resourceId: null,
        resourceTitle: title,
        sourceId: input.sourceId ?? null,
        status: "failed",
        error,
      });
      return { ok: false, resourceId: null, resourceTitle: title, error };
    }
    const resourceId = body.data?.articleCreate?.article?.id ?? null;
    await record(input.db, {
      shopId: input.shopId,
      contentType: "blog_article",
      resourceId,
      resourceTitle: title,
      sourceId: input.sourceId ?? null,
      status: "published",
      error: null,
    });
    return { ok: true, resourceId, resourceTitle: title, error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Shopify blog article publish failed.";
    await record(input.db, {
      shopId: input.shopId,
      contentType: "blog_article",
      resourceId: null,
      resourceTitle: title,
      sourceId: input.sourceId ?? null,
      status: "failed",
      error,
    });
    return { ok: false, resourceId: null, resourceTitle: title, error };
  }
}

export async function deleteShopifyPage(input: {
  db: PrismaClient;
  admin: AdminLike;
  publishedContentId: string;
  resourceId: string;
}): Promise<{ ok: boolean; error: string | null }> {
  try {
    const body = await graph<{
      data?: {
        pageDelete?: {
          deletedPageId?: string | null;
          userErrors?: Array<{ message: string }>;
        };
      };
    }>(input.admin, `mutation PageDelete($id: ID!) { pageDelete(id: $id) { deletedPageId userErrors { message } } }`, {
      id: input.resourceId,
    });
    const errors = body.data?.pageDelete?.userErrors ?? [];
    if (errors.length > 0) return { ok: false, error: errors.map((e) => e.message).join("; ") };
    const model = getModel(input.db);
    if (model) await model.update({ where: { id: input.publishedContentId }, data: { status: "deleted" } });
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Delete failed." };
  }
}

export async function deleteShopifyArticle(input: {
  db: PrismaClient;
  admin: AdminLike;
  publishedContentId: string;
  resourceId: string;
}): Promise<{ ok: boolean; error: string | null }> {
  try {
    const body = await graph<{
      data?: {
        articleDelete?: {
          deletedArticleId?: string | null;
          userErrors?: Array<{ message: string }>;
        };
      };
    }>(
      input.admin,
      `mutation ArticleDelete($id: ID!) { articleDelete(id: $id) { deletedArticleId userErrors { message } } }`,
      { id: input.resourceId },
    );
    const errors = body.data?.articleDelete?.userErrors ?? [];
    if (errors.length > 0) return { ok: false, error: errors.map((e) => e.message).join("; ") };
    const model = getModel(input.db);
    if (model) await model.update({ where: { id: input.publishedContentId }, data: { status: "deleted" } });
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Delete failed." };
  }
}

export async function getPublishedContent(
  db: PrismaClient,
  shopId: string,
): Promise<PublishedContentRow[]> {
  const model = getModel(db);
  if (!model) return [];
  return model.findMany({
    where: { shopId },
    orderBy: { publishedAt: "desc" },
    take: 50,
  });
}

export async function getPublishedCounts(
  db: PrismaClient,
  shopId: string,
): Promise<{ total: number; pages: number; blogs: number; productFaqs: number }> {
  const model = getModel(db);
  const PAGE_TYPES = [
    "faq_page",
    "shipping_page",
    "return_page",
    "warranty_page",
    "payment_page",
    "discount_page",
  ];

  const [pages, blogs] = await Promise.all([
    model
      ? model.count({ where: { shopId, status: "published", contentType: { in: PAGE_TYPES } } })
      : Promise.resolve(0),
    model
      ? model.count({ where: { shopId, status: "published", contentType: "blog_article" } })
      : Promise.resolve(0),
  ]);

  const generatedFaqDelegate = (
    db as unknown as {
      generatedFaq?: { count: (args: Record<string, unknown>) => Promise<number> };
    }
  ).generatedFaq;
  const productFaqs = generatedFaqDelegate
    ? await generatedFaqDelegate.count({ where: { shopId, status: "published" } })
    : 0;

  return {
    total: pages + blogs + productFaqs,
    pages,
    blogs,
    productFaqs,
  };
}
