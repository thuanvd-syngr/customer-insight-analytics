import type { NormalizedMessage, PageInput, ProductInput } from "~/lib/types";

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
    data?: {
      orders?: {
        nodes?: Array<{ id: string; note?: string | null; email?: string | null; createdAt: string }>;
      };
    };
  }>(
    admin,
    `query Orders($first: Int!) {
      orders(first: $first, sortKey: CREATED_AT, reverse: true) {
        nodes { id note email createdAt }
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
