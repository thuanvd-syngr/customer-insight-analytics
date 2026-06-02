import type { NormalizedMessage, PageInput, ProductInput } from "~/lib/types";
import type { PrismaClient } from "@prisma/client";
import { getDelegate } from "~/lib/prisma-safe";
import { getShopifyProductSchemaDiagnostics } from "~/lib/schema-diagnostics.server";
import { processInBatches } from "~/lib/utils";

export interface AdminLike {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

async function graph<T>(
  admin: AdminLike,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await admin.graphql(query, { variables });
  const body = (await res.json()) as T & { errors?: Array<{ message: string }> };
  if (body.errors?.length) {
    throw new Error(body.errors.map((error) => error.message).join("; "));
  }
  return body;
}

export type SyncStepResult = {
  ok: boolean;
  count: number;
  skipped?: boolean;
  reason?: string;
  error?: string;
};

export type ShopifySyncResult = {
  products: SyncStepResult;
  orders: SyncStepResult;
  customers: SyncStepResult;
  messages: number;
};

type ShopifyProductWriteData = {
  title: string;
  handle?: string | null;
  description: string;
  rawJson: string;
  syncedAt: Date;
  vendor?: string | null;
  tags?: string;
  productType?: string | null;
  shopifyUpdatedAt?: Date | null;
  collections?: string;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Shopify sync failed.";
}

function isAccessError(error: unknown): boolean {
  return /(access|approved|protected|permission|scope|customer object)/i.test(errorMessage(error));
}

function hasScope(grantedScopes: string | null | undefined, scope: string): boolean {
  return (grantedScopes ?? "")
    .split(",")
    .map((item) => item.trim())
    .includes(scope);
}

function friendlyProductSyncError(error: unknown): string {
  const message = errorMessage(error);
  if (/unknown argument/i.test(message)) {
    return "Database schema is older than application code. Run prisma migrate deploy.";
  }
  return message;
}

type PageInfo = { hasNextPage: boolean; endCursor?: string | null };

async function fetchConnection<TNode, TBody>(
  admin: AdminLike,
  query: string,
  variables: Record<string, unknown>,
  read: (body: TBody) => { nodes?: TNode[]; pageInfo?: PageInfo } | undefined,
  limit = 1000,
): Promise<TNode[]> {
  const nodes: TNode[] = [];
  let cursor: string | null = null;
  do {
    const body = await graph<TBody>(admin, query, { ...variables, after: cursor });
    const connection = read(body);
    nodes.push(...(connection?.nodes ?? []));
    const pageInfo = connection?.pageInfo;
    cursor = pageInfo?.hasNextPage ? pageInfo.endCursor ?? null : null;
  } while (cursor && nodes.length < limit);
  return nodes.slice(0, limit);
}

export async function fetchOrders(
  admin: AdminLike,
  opts: { first?: number } = {},
): Promise<NormalizedMessage[]> {
  const body = await graph<{
    data?: { orders?: { nodes?: ShopifyOrderNode[] } };
  }>(
    admin,
    `query Orders($first: Int!) {
      orders(first: $first, sortKey: CREATED_AT, reverse: true) {
        nodes { id name note tags createdAt processedAt }
      }
    }`,
    { first: opts.first ?? 50 },
  );

  return (body.data?.orders?.nodes ?? []).flatMap((order) => {
    const occurredAt = new Date(order.createdAt);
    const messages: NormalizedMessage[] = [];
    if (order.note) {
      messages.push({
        id: `${order.id}-note`,
        content: order.note,
        occurredAt,
        source: "order_note",
        externalId: order.id,
        customerRef: null,
      });
    }
    return messages;
  });
}

export async function fetchProducts(
  admin: AdminLike,
  opts: { first?: number; limit?: number } = {},
): Promise<ProductInput[]> {
  const products = await fetchConnection<
    ShopifyProductNode,
    {
    data?: {
      products?: {
        nodes?: ShopifyProductNode[];
        pageInfo?: PageInfo;
      };
    };
  }>(
    admin,
    `query Products($first: Int!, $after: String) {
      products(first: $first, after: $after, sortKey: UPDATED_AT, reverse: true) {
        nodes {
          id
          title
          handle
          vendor
          updatedAt
          descriptionHtml
          tags
          productType
          collections(first: 20) { nodes { id title handle } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    { first: opts.first ?? 50 },
    (body) => body.data?.products,
    opts.limit ?? opts.first ?? 1000,
  );

  return products.map((product) => ({
    id: product.id,
    title: product.title,
    handle: product.handle ?? undefined,
    vendor: product.vendor ?? null,
    updatedAt: product.updatedAt ?? null,
    description: product.descriptionHtml ?? "",
    tags: product.tags ?? [],
    productType: product.productType ?? null,
    collections: product.collections?.nodes?.map((collection) => collection.title) ?? [],
  }));
}

interface ShopifyCollectionNode {
  id: string;
  title: string;
  handle?: string | null;
}

interface ShopifyProductNode {
  id: string;
  title: string;
  handle?: string | null;
  vendor?: string | null;
  updatedAt?: string | null;
  descriptionHtml?: string | null;
  tags?: string[] | null;
  productType?: string | null;
  collections?: { nodes?: ShopifyCollectionNode[] };
}

interface ShopifyOrderNode {
  id: string;
  name?: string | null;
  note?: string | null;
  tags?: string[] | null;
  createdAt: string;
  processedAt?: string | null;
}

export async function fetchOrderSnapshots(
  admin: AdminLike,
  opts: { first?: number; limit?: number } = {},
): Promise<ShopifyOrderNode[]> {
  return fetchConnection<ShopifyOrderNode, { data?: { orders?: { nodes?: ShopifyOrderNode[]; pageInfo?: PageInfo } } }>(
    admin,
    `query Orders($first: Int!, $after: String) {
      orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
        nodes { id name note tags createdAt processedAt }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    { first: opts.first ?? 50 },
    (body) => body.data?.orders,
    opts.limit ?? opts.first ?? 1000,
  );
}

export async function fetchPages(
  admin: AdminLike,
  opts: { first?: number } = {},
): Promise<PageInput[]> {
  try {
    const body = await graph<{
      data?: { pages?: { nodes?: Array<{ title: string; body?: string | null }> } };
    }>(
      admin,
      `query Pages($first: Int!) {
        pages(first: $first) { nodes { title body } }
      }`,
      { first: opts.first ?? 25 },
    );
    return (body.data?.pages?.nodes ?? []).map((page) => ({
      title: page.title,
      body: page.body ?? "",
    }));
  } catch {
    return [];
  }
}

export async function collectShopData(
  admin: AdminLike,
  opts: { orders?: number; products?: number; pages?: number } = {},
): Promise<{
  messages: NormalizedMessage[];
  products: ProductInput[];
  pages: PageInput[];
}> {
  const [messages, products, pages] = await Promise.all([
    fetchOrders(admin, { first: opts.orders }).catch((error) => {
      console.warn("Order note sync skipped", errorMessage(error));
      return [] as NormalizedMessage[];
    }),
    fetchProducts(admin, { limit: opts.products }).catch((error) => {
      console.warn("Product sync skipped", errorMessage(error));
      return [] as ProductInput[];
    }),
    fetchPages(admin, { first: opts.pages }),
  ]);
  return { messages, products, pages };
}

export async function syncShopifyData(
  db: PrismaClient,
  shopId: string,
  admin: AdminLike,
  opts: { shopDomain?: string; grantedScopes?: string | null } = {},
): Promise<ShopifySyncResult> {
  const now = new Date();
  const shopifyProduct = getDelegate(db, "shopifyProduct");
  const shopifyOrder = getDelegate(db, "shopifyOrder");
  const importedMessage = getDelegate(db, "importedMessage");
  const result: ShopifySyncResult = {
    products: { ok: true, count: 0 },
    orders: { ok: true, count: 0 },
    customers: {
      ok: false,
      count: 0,
      skipped: true,
      reason: "Protected customer data not approved",
    },
    messages: 0,
  };

  let products: ProductInput[] = [];
  try {
    const schema = await getShopifyProductSchemaDiagnostics(db);
    const includeTags = schema.hasTags && schema.clientHasTags;
    const includeVendor = schema.hasVendor && schema.clientHasVendor;
    const includeProductType = schema.hasProductType && schema.clientHasProductType;
    const includeShopifyUpdatedAt = schema.hasShopifyUpdatedAt && schema.clientHasShopifyUpdatedAt;
    const includeCollections = schema.hasCollections && schema.clientHasCollections;
    if (schema.compatibilityMode) {
      console.warn("Schema mismatch detected. Running compatibility mode.", {
        shop: opts.shopDomain,
        tags: includeTags,
        vendor: includeVendor,
        productType: includeProductType,
        shopifyUpdatedAt: includeShopifyUpdatedAt,
        collections: includeCollections,
        migrationVersion: schema.migrationVersion,
      });
    }
    console.info("Shopify product sync attempted", {
      shop: opts.shopDomain,
      grantedScopes: opts.grantedScopes,
      maxProducts: 1000,
    });
    products = await fetchProducts(admin, { first: 50, limit: 1000 });
    console.info("Shopify product sync returned", {
      shop: opts.shopDomain,
      count: products.length,
    });
    if (!shopifyProduct?.upsert) {
      result.products = { ok: false, count: 0, skipped: false, error: "Product database model unavailable" };
    } else {
      const upsertProduct = shopifyProduct.upsert.bind(shopifyProduct);
      await processInBatches(products, 50, (product) => {
        const writeData: ShopifyProductWriteData = {
          title: product.title,
          handle: product.handle,
          description: product.description ?? "",
          rawJson: JSON.stringify(product),
          syncedAt: now,
        };
        if (includeTags) writeData.tags = JSON.stringify(product.tags ?? []);
        if (includeVendor) writeData.vendor = product.vendor ?? null;
        if (includeProductType) writeData.productType = product.productType ?? null;
        if (includeShopifyUpdatedAt) writeData.shopifyUpdatedAt = product.updatedAt ? new Date(product.updatedAt) : null;
        if (includeCollections) writeData.collections = JSON.stringify(product.collections ?? []);
        return upsertProduct({
          where: { shopId_externalId: { shopId, externalId: product.id ?? product.title } },
          update: writeData,
          create: {
            shopId,
            externalId: product.id ?? product.title,
            ...writeData,
          },
        });
      });
      result.products = { ok: true, count: products.length };
    }
  } catch (error) {
    console.warn("Shopify product sync failed", {
      shop: opts.shopDomain,
      error: friendlyProductSyncError(error),
    });
    result.products = { ok: false, count: 0, error: friendlyProductSyncError(error), skipped: false };
  }

  let orders: ShopifyOrderNode[] = [];
  try {
    if (!hasScope(opts.grantedScopes, "read_orders")) {
      result.orders = {
        ok: false,
        count: 0,
        skipped: true,
        reason: "Orders could not be synced because Shopify requires re-installing the app after scope changes.",
      };
    } else {
      orders = await fetchOrderSnapshots(admin, { first: 100, limit: 1000 });
      if (!shopifyOrder?.upsert) {
        result.orders = { ok: false, count: 0, skipped: true, reason: "Order storage unavailable" };
      } else {
        const upsertOrder = shopifyOrder.upsert.bind(shopifyOrder);
        await processInBatches(orders, 50, (order) =>
          upsertOrder({
            where: { shopId_externalId: { shopId, externalId: order.id } },
            update: {
              name: order.name,
              note: order.note,
              customerRef: null,
              tags: JSON.stringify(order.tags ?? []),
              processedAt: order.processedAt ? new Date(order.processedAt) : new Date(order.createdAt),
              rawJson: JSON.stringify(order),
              syncedAt: now,
            },
            create: {
              shopId,
              externalId: order.id,
              name: order.name,
              note: order.note,
              customerRef: null,
              tags: JSON.stringify(order.tags ?? []),
              processedAt: order.processedAt ? new Date(order.processedAt) : new Date(order.createdAt),
              rawJson: JSON.stringify(order),
              syncedAt: now,
            },
          }),
        );
        result.orders = {
          ok: true,
          count: orders.length,
          reason: orders.length === 0 ? "No orders found in this dev store." : undefined,
        };
      }
    }
  } catch (error) {
    result.orders = {
      ok: false,
      count: 0,
      error: errorMessage(error),
      skipped: isAccessError(error),
      reason: isAccessError(error)
        ? "Orders could not be synced because Shopify requires re-installing the app after scope changes."
        : undefined,
    };
  }

  const messageInputs = [
    ...orders.flatMap((order) => [
      order.note
        ? {
            shopId,
            source: "order_note",
            externalId: `${order.id}:note`,
            customerRef: null,
            content: order.note,
            occurredAt: order.processedAt ? new Date(order.processedAt) : new Date(order.createdAt),
          }
        : null,
      order.tags?.length
        ? {
            shopId,
            source: "order_tags",
            externalId: `${order.id}:tags`,
            customerRef: null,
            content: `Order tags: ${order.tags.join(", ")}`,
            occurredAt: order.processedAt ? new Date(order.processedAt) : new Date(order.createdAt),
          }
        : null,
    ]),
    ...products.flatMap((product) => [
      {
      shopId,
      source: "product_text",
      externalId: `${product.id}:description`,
      customerRef: null,
      content: [
        product.title,
        product.description ?? "",
        product.productType ? `Product type: ${product.productType}` : "",
        product.tags?.length ? `Product tags: ${product.tags.join(", ")}` : "",
        product.collections?.length ? `Collections: ${product.collections.join(", ")}` : "",
      ].filter(Boolean).join(". "),
      occurredAt: now,
      },
      product.tags?.length
        ? {
            shopId,
            source: "product_tags",
            externalId: `${product.id}:tags`,
            customerRef: null,
            content: `Product tags for ${product.title}: ${product.tags.join(", ")}`,
            occurredAt: now,
          }
        : null,
    ]),
  ].filter((message): message is NonNullable<typeof message> => Boolean(message?.content.trim()));

  if (!importedMessage?.findMany || !importedMessage?.createMany) {
    return result;
  }
  const externalIds = messageInputs.map((m) => m.externalId);
  const existing = await importedMessage.findMany({
    where: { shopId, externalId: { in: externalIds } },
    select: { externalId: true },
  });
  const existingIds = new Set(existing.map((m: { externalId: string | null }) => m.externalId));
  const newMessages = messageInputs.filter((m) => !existingIds.has(m.externalId));
  if (newMessages.length > 0) {
    await importedMessage.createMany({ data: newMessages, skipDuplicates: true });
  }
  result.messages = newMessages.length;

  return result;
}
