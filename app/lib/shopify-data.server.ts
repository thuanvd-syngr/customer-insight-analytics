import type { NormalizedMessage, PageInput, ProductInput } from "~/lib/types";
import type { PrismaClient } from "@prisma/client";
import { getDelegate } from "~/lib/prisma-safe";
import { getShopifyProductSchemaDiagnostics } from "~/lib/schema-diagnostics.server";
import { hasRequiredScope } from "~/lib/scope-guard.server";
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
  context?: { shop?: string; operation?: string },
): Promise<T> {
  const operationName =
    context?.operation ??
    (query.trim().match(/^(?:query|mutation)\s+(\w+)/)?.[1] ?? query.slice(0, 60));
  let res: Response;
  try {
    res = await admin.graphql(query, { variables });
  } catch (error) {
    throw await normalizeGraphqlTransportError(error, operationName);
  }
  const httpStatus = res.status;
  let body: T & {
    data?: unknown;
    errors?: Array<{ message: string; extensions?: { code?: string } }>;
    extensions?: { cost?: unknown };
  };
  try {
    body = (await res.json()) as typeof body;
  } catch (error) {
    throw new Error(`[${operationName}] Shopify Admin GraphQL returned an unreadable response (${httpStatus}): ${errorMessage(error)}`);
  }
  if (httpStatus >= 400 && !body.errors?.length) {
    throw new Error(`[${operationName}] Shopify Admin GraphQL HTTP ${httpStatus}: ${summarizeResponseBody(body)}`);
  }
  if (body.errors?.length) {
    console.error("[shopify-data] GraphQL top-level errors", {
      shop: context?.shop,
      operationName,
      httpStatus,
      variables,
      errors: body.errors,
      data: body.data ?? null,
    });
    const errorMessages = body.errors
      .map((e) => (e.extensions?.code ? `${e.message} [${e.extensions.code}]` : e.message))
      .join("; ");
    throw new Error(`[${operationName}] ${errorMessages}`);
  }
  return body;
}

async function normalizeGraphqlTransportError(error: unknown, operationName: string): Promise<Error> {
  if (error instanceof Response) {
    const status = error.status;
    let bodyText = "";
    try {
      bodyText = await error.clone().text();
    } catch {
      bodyText = "";
    }
    return new Error(
      `[${operationName}] Shopify Admin GraphQL HTTP ${status}: ${bodyText.trim() || error.statusText || "empty response body"}`,
    );
  }
  if (error instanceof Error) return error;
  return new Error(`[${operationName}] ${errorMessage(error)}`);
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

const SHOPIFY_ADMIN_REST_VERSION = "2026-01";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error instanceof Headers) return "Shopify Admin GraphQL request failed with empty response headers.";
  if (error instanceof Response) return `HTTP ${error.status}: ${error.statusText || "Shopify Admin GraphQL response error"}`;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function summarizeResponseBody(body: unknown): string {
  if (body && typeof body === "object") {
    const maybeErrors = (body as { errors?: Array<{ message?: string }> }).errors;
    if (Array.isArray(maybeErrors) && maybeErrors.length > 0) {
      return maybeErrors.map((error) => error.message).filter(Boolean).join("; ");
    }
  }
  const message = errorMessage(body);
  return message === "{}" ? "empty response body" : message;
}

function isAccessError(error: unknown): boolean {
  return /(access|approved|protected|permission|scope|customer object|unauthorized|token|forbidden)/i.test(errorMessage(error));
}

function isGraphqlForbidden(error: unknown): boolean {
  return /GraphQL Client: Forbidden|HTTP 403/i.test(errorMessage(error));
}

function hasScope(grantedScopes: string | null | undefined, scope: string): boolean {
  return hasRequiredScope(grantedScopes, scope);
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
  context?: { shop?: string; operation?: string },
): Promise<TNode[]> {
  const nodes: TNode[] = [];
  let cursor: string | null = null;
  do {
    const body = await graph<TBody>(admin, query, { ...variables, after: cursor }, context);
    const connection = read(body);
    nodes.push(...(connection?.nodes ?? []));
    const pageInfo = connection?.pageInfo;
    cursor = pageInfo?.hasNextPage ? pageInfo.endCursor ?? null : null;
  } while (cursor && nodes.length < limit);
  return nodes.slice(0, limit);
}

export async function fetchOrders(
  admin: AdminLike,
  opts: { first?: number; context?: { shop?: string } } = {},
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
    { operation: "Orders", shop: opts.context?.shop },
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
  opts: { first?: number; limit?: number; context?: { shop?: string } } = {},
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
    { operation: "Products", shop: opts.context?.shop },
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

interface ShopifyRestProduct {
  id: number | string;
  admin_graphql_api_id?: string | null;
  title?: string | null;
  handle?: string | null;
  vendor?: string | null;
  updated_at?: string | null;
  body_html?: string | null;
  tags?: string | string[] | null;
  product_type?: string | null;
}

interface ShopifyRestOrder {
  id: number | string;
  admin_graphql_api_id?: string | null;
  name?: string | null;
  note?: string | null;
  tags?: string | string[] | null;
  created_at?: string | null;
  processed_at?: string | null;
}

function splitShopifyTags(tags: string | string[] | null | undefined): string[] {
  if (Array.isArray(tags)) return tags;
  return String(tags ?? "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

async function fetchShopifyRestJson<T>(
  opts: { shopDomain?: string; accessToken?: string | null; path: string },
): Promise<T> {
  if (!opts.shopDomain) throw new Error("Shopify shop domain is unavailable for REST fallback.");
  if (!opts.accessToken) throw new Error("Shopify access token is unavailable for REST fallback.");
  const url = new URL(`https://${opts.shopDomain}/admin/api/${SHOPIFY_ADMIN_REST_VERSION}/${opts.path}`);
  const response = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": opts.accessToken,
      "Accept": "application/json",
    },
  });
  const text = await response.text();
  let body: unknown = null;
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (response.status >= 400) {
    throw new Error(`Shopify Admin REST HTTP ${response.status}: ${summarizeResponseBody(body)}`);
  }
  return body as T;
}

async function fetchProductsRest(
  opts: { shopDomain?: string; accessToken?: string | null; limit?: number },
): Promise<ProductInput[]> {
  const limit = Math.min(Math.max(opts.limit ?? 250, 1), 250);
  const body = await fetchShopifyRestJson<{ products?: ShopifyRestProduct[] }>({
    shopDomain: opts.shopDomain,
    accessToken: opts.accessToken,
    path: `products.json?limit=${limit}&fields=id,admin_graphql_api_id,title,handle,vendor,updated_at,body_html,tags,product_type`,
  });
  return (body.products ?? []).map((product) => ({
    id: product.admin_graphql_api_id ?? `gid://shopify/Product/${product.id}`,
    title: product.title ?? "Untitled product",
    handle: product.handle ?? undefined,
    vendor: product.vendor ?? null,
    updatedAt: product.updated_at ?? null,
    description: product.body_html ?? "",
    tags: splitShopifyTags(product.tags),
    productType: product.product_type ?? null,
    collections: [],
  }));
}

async function fetchOrderSnapshotsRest(
  opts: { shopDomain?: string; accessToken?: string | null; limit?: number },
): Promise<ShopifyOrderNode[]> {
  const limit = Math.min(Math.max(opts.limit ?? 250, 1), 250);
  const body = await fetchShopifyRestJson<{ orders?: ShopifyRestOrder[] }>({
    shopDomain: opts.shopDomain,
    accessToken: opts.accessToken,
    path: `orders.json?status=any&limit=${limit}&fields=id,admin_graphql_api_id,name,note,tags,created_at,processed_at`,
  });
  return (body.orders ?? []).map((order) => ({
    id: order.admin_graphql_api_id ?? `gid://shopify/Order/${order.id}`,
    name: order.name ?? null,
    note: order.note ?? null,
    tags: splitShopifyTags(order.tags),
    createdAt: order.created_at ?? new Date().toISOString(),
    processedAt: order.processed_at ?? order.created_at ?? null,
  }));
}

export async function fetchOrderSnapshots(
  admin: AdminLike,
  opts: { first?: number; limit?: number; context?: { shop?: string } } = {},
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
    { operation: "Orders", shop: opts.context?.shop },
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
  opts: { shopDomain?: string; grantedScopes?: string | null; accessToken?: string | null } = {},
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
      hasReadProducts: hasScope(opts.grantedScopes, "read_products"),
      hasWriteProducts: hasScope(opts.grantedScopes, "write_products"),
      hasReadContent: hasScope(opts.grantedScopes, "read_content"),
      hasWriteContent: hasScope(opts.grantedScopes, "write_content"),
      maxProducts: 1000,
    });
    try {
      products = await fetchProducts(admin, { first: 50, limit: 1000, context: { shop: opts.shopDomain } });
    } catch (graphqlError) {
      if (!isGraphqlForbidden(graphqlError)) throw graphqlError;
      console.warn("Shopify product GraphQL sync forbidden. Trying REST fallback.", {
        shop: opts.shopDomain,
        grantedScopes: opts.grantedScopes,
        error: errorMessage(graphqlError),
      });
      try {
        products = await fetchProductsRest({
          shopDomain: opts.shopDomain,
          accessToken: opts.accessToken,
          limit: 250,
        });
      } catch (restError) {
        throw new Error(`${errorMessage(graphqlError)}; REST fallback failed: ${errorMessage(restError)}`);
      }
    }
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
    const msg = friendlyProductSyncError(error);
    console.error("Shopify product sync failed", {
      shop: opts.shopDomain,
      grantedScopes: opts.grantedScopes,
      error: msg,
      stack: error instanceof Error ? error.stack : undefined,
      isAccessError: isAccessError(error),
    });
    result.products = { ok: false, count: 0, error: msg, skipped: false };
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
      try {
        orders = await fetchOrderSnapshots(admin, { first: 100, limit: 1000, context: { shop: opts.shopDomain } });
      } catch (graphqlError) {
        if (!isGraphqlForbidden(graphqlError)) throw graphqlError;
        console.warn("Shopify order GraphQL sync forbidden. Trying REST fallback.", {
          shop: opts.shopDomain,
          grantedScopes: opts.grantedScopes,
          error: errorMessage(graphqlError),
        });
        try {
          orders = await fetchOrderSnapshotsRest({
            shopDomain: opts.shopDomain,
            accessToken: opts.accessToken,
            limit: 250,
          });
        } catch (restError) {
          throw new Error(`${errorMessage(graphqlError)}; REST fallback failed: ${errorMessage(restError)}`);
        }
      }
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
    const accessError = isAccessError(error);
    const msg = errorMessage(error);
    console.error("Shopify order sync failed", {
      shop: opts.shopDomain,
      grantedScopes: opts.grantedScopes,
      error: msg,
      stack: error instanceof Error ? error.stack : undefined,
      isAccessError: accessError,
    });
    result.orders = {
      ok: false,
      count: 0,
      error: msg,
      skipped: accessError,
      reason: accessError
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
