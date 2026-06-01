import type { NormalizedMessage, PageInput, ProductInput } from "~/lib/types";
import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

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
  return (await res.json()) as T;
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
        nodes { id name note email tags createdAt processedAt }
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
        customerRef: order.email ?? null,
      });
    }
    if (order.email) {
      messages.push({
        id: `${order.id}-email`,
        content: `Customer email domain: ${order.email.split("@")[1] ?? order.email}`,
        occurredAt,
        source: "customer_email",
        externalId: order.id,
        customerRef: order.email,
      });
    }
    return messages;
  });
}

export async function fetchProducts(
  admin: AdminLike,
  opts: { first?: number } = {},
): Promise<ProductInput[]> {
  const body = await graph<{
    data?: {
      products?: {
        nodes?: Array<{ id: string; title: string; handle: string; description?: string | null }>;
      };
    };
  }>(
    admin,
    `query Products($first: Int!) {
      products(first: $first) {
        nodes { id title handle description }
      }
    }`,
    { first: opts.first ?? 50 },
  );

  return (body.data?.products?.nodes ?? []).map((product) => ({
    id: product.id,
    title: product.title,
    handle: product.handle,
    description: product.description ?? "",
  }));
}

interface ShopifyOrderNode {
  id: string;
  name?: string | null;
  note?: string | null;
  email?: string | null;
  tags?: string[] | null;
  createdAt: string;
  processedAt?: string | null;
}

interface ShopifyCustomerNode {
  id: string;
  displayName?: string | null;
  email?: string | null;
  tags?: string[] | null;
  note?: string | null;
}

function hashEmail(email?: string | null): string | null {
  if (!email) return null;
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export async function fetchCustomerSnapshots(
  admin: AdminLike,
  opts: { first?: number } = {},
): Promise<ShopifyCustomerNode[]> {
  const body = await graph<{ data?: { customers?: { nodes?: ShopifyCustomerNode[] } } }>(
    admin,
    `query Customers($first: Int!) {
      customers(first: $first, sortKey: UPDATED_AT, reverse: true) {
        nodes { id displayName email tags note }
      }
    }`,
    { first: opts.first ?? 50 },
  );
  return body.data?.customers?.nodes ?? [];
}

export async function fetchOrderSnapshots(
  admin: AdminLike,
  opts: { first?: number } = {},
): Promise<ShopifyOrderNode[]> {
  const body = await graph<{ data?: { orders?: { nodes?: ShopifyOrderNode[] } } }>(
    admin,
    `query Orders($first: Int!) {
      orders(first: $first, sortKey: CREATED_AT, reverse: true) {
        nodes { id name note email tags createdAt processedAt }
      }
    }`,
    { first: opts.first ?? 50 },
  );
  return body.data?.orders?.nodes ?? [];
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
    fetchOrders(admin, { first: opts.orders }),
    fetchProducts(admin, { first: opts.products }),
    fetchPages(admin, { first: opts.pages }),
  ]);
  return { messages, products, pages };
}

export async function syncShopifyData(
  db: PrismaClient,
  shopId: string,
  admin: AdminLike,
): Promise<{ products: number; orders: number; customers: number; messages: number }> {
  const [products, orders, customers] = await Promise.all([
    fetchProducts(admin, { first: 100 }),
    fetchOrderSnapshots(admin, { first: 100 }),
    fetchCustomerSnapshots(admin, { first: 100 }),
  ]);
  const now = new Date();

  await Promise.all(products.map((product) =>
    db.shopifyProduct.upsert({
      where: { shopId_externalId: { shopId, externalId: product.id ?? product.title } },
      update: {
        title: product.title,
        handle: product.handle,
        description: product.description ?? "",
        rawJson: JSON.stringify(product),
        syncedAt: now,
      },
      create: {
        shopId,
        externalId: product.id ?? product.title,
        title: product.title,
        handle: product.handle,
        description: product.description ?? "",
        rawJson: JSON.stringify(product),
        syncedAt: now,
      },
    }),
  ));

  await Promise.all(orders.map((order) =>
    db.shopifyOrder.upsert({
      where: { shopId_externalId: { shopId, externalId: order.id } },
      update: {
        name: order.name,
        note: order.note,
        customerRef: hashEmail(order.email),
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
        customerRef: hashEmail(order.email),
        tags: JSON.stringify(order.tags ?? []),
        processedAt: order.processedAt ? new Date(order.processedAt) : new Date(order.createdAt),
        rawJson: JSON.stringify(order),
        syncedAt: now,
      },
    }),
  ));

  await Promise.all(customers.map((customer) =>
    db.shopifyCustomer.upsert({
      where: { shopId_externalId: { shopId, externalId: customer.id } },
      update: {
        displayName: customer.displayName,
        emailHash: hashEmail(customer.email),
        tags: JSON.stringify(customer.tags ?? []),
        note: customer.note,
        rawJson: JSON.stringify(customer),
        syncedAt: now,
      },
      create: {
        shopId,
        externalId: customer.id,
        displayName: customer.displayName,
        emailHash: hashEmail(customer.email),
        tags: JSON.stringify(customer.tags ?? []),
        note: customer.note,
        rawJson: JSON.stringify(customer),
        syncedAt: now,
      },
    }),
  ));

  const messageInputs = [
    ...orders.flatMap((order) => [
      order.note
        ? {
            shopId,
            source: "order_note",
            externalId: `${order.id}:note`,
            customerRef: hashEmail(order.email),
            content: order.note,
            occurredAt: order.processedAt ? new Date(order.processedAt) : new Date(order.createdAt),
          }
        : null,
      order.tags?.length
        ? {
            shopId,
            source: "order_tags",
            externalId: `${order.id}:tags`,
            customerRef: hashEmail(order.email),
            content: `Order tags: ${order.tags.join(", ")}`,
            occurredAt: order.processedAt ? new Date(order.processedAt) : new Date(order.createdAt),
          }
        : null,
    ]),
    ...customers.flatMap((customer) => [
      customer.note
        ? {
            shopId,
            source: "customer_note",
            externalId: `${customer.id}:note`,
            customerRef: hashEmail(customer.email),
            content: customer.note,
            occurredAt: now,
          }
        : null,
      customer.tags?.length
        ? {
            shopId,
            source: "customer_tags",
            externalId: `${customer.id}:tags`,
            customerRef: hashEmail(customer.email),
            content: `Customer tags: ${customer.tags.join(", ")}`,
            occurredAt: now,
          }
        : null,
    ]),
    ...products.map((product) => ({
      shopId,
      source: "product_text",
      externalId: `${product.id}:description`,
      customerRef: null,
      content: `${product.title}. ${product.description ?? ""}`,
      occurredAt: now,
    })),
  ].filter((message): message is NonNullable<typeof message> => Boolean(message?.content.trim()));

  let messages = 0;
  for (const message of messageInputs) {
    const existing = await db.importedMessage.findFirst({
      where: { shopId, externalId: message.externalId },
      select: { id: true },
    });
    if (!existing) {
      await db.importedMessage.create({ data: message });
      messages += 1;
    }
  }

  return { products: products.length, orders: orders.length, customers: customers.length, messages };
}
