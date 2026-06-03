import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

import prisma from "~/db.server";
import { missingScopes, CONTENT_PUBLISH_SCOPES, PRODUCT_FAQ_PUBLISH_SCOPES } from "~/lib/action-loading";
import { getDelegate } from "~/lib/prisma-safe";
import { ensureShop, getLatestRun } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);

  const [productCount, orderCount, messageCount, latestRun] = await Promise.all([
    prisma.shopifyProduct.count({ where: { shopId: shop.id } }),
    prisma.shopifyOrder.count({ where: { shopId: shop.id } }),
    prisma.importedMessage.count({ where: { shopId: shop.id } }),
    getLatestRun(prisma, shop.id),
  ]);

  const lastSyncResult = getDelegate(prisma, "bulkJob");
  const recentJob = lastSyncResult?.findFirst
    ? await lastSyncResult.findFirst({
        where: { shopId: shop.id, jobType: "publish_pages" },
        orderBy: { createdAt: "desc" },
      })
    : null;

  // Probe products: surfaces API auth errors and field availability
  type ProbeResult<T> = { ok: boolean; data?: T; errors?: unknown[]; httpStatus?: number; error?: string };
  let productsProbe: ProbeResult<Array<{ id: string; title: string; handle: string | null }>>;
  const PROBE_PRODUCTS = `query DiagProducts { products(first: 1) { nodes { id title handle } } }`;
  try {
    const res = await admin.graphql(PROBE_PRODUCTS);
    const httpStatus = res.status;
    const body = (await res.json()) as {
      data?: { products?: { nodes?: Array<{ id: string; title: string; handle: string | null }> } };
      errors?: Array<{ message: string }>;
    };
    productsProbe = body.errors?.length
      ? { ok: false, errors: body.errors, httpStatus, error: body.errors.map((e) => e.message).join("; ") }
      : { ok: true, data: body.data?.products?.nodes ?? [], httpStatus };
  } catch (error) {
    productsProbe = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  // Probe orders: surfaces read_orders scope errors separately from product errors
  let ordersProbe: ProbeResult<Array<{ id: string; name: string | null; createdAt: string }>>;
  const PROBE_ORDERS = `query DiagOrders { orders(first: 1) { nodes { id name createdAt } } }`;
  try {
    const res = await admin.graphql(PROBE_ORDERS);
    const httpStatus = res.status;
    const body = (await res.json()) as {
      data?: { orders?: { nodes?: Array<{ id: string; name: string | null; createdAt: string }> } };
      errors?: Array<{ message: string }>;
    };
    ordersProbe = body.errors?.length
      ? { ok: false, errors: body.errors, httpStatus, error: body.errors.map((e) => e.message).join("; ") }
      : { ok: true, data: body.data?.orders?.nodes ?? [], httpStatus };
  } catch (error) {
    ordersProbe = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const grantedScopes = session.scope ?? "";
  const grantedScopeList = grantedScopes.split(",").map((s) => s.trim()).filter(Boolean);

  return json({
    // Session
    shop: session.shop,
    grantedScopes: grantedScopeList,
    missingContentScopes: missingScopes(grantedScopes, CONTENT_PUBLISH_SCOPES),
    missingProductFaqScopes: missingScopes(grantedScopes, PRODUCT_FAQ_PUBLISH_SCOPES),

    // DB counts
    productCount,
    orderCount,
    messageCount,

    // Last analysis run
    lastRunId: latestRun?.id ?? null,
    lastRunAt: latestRun?.finishedAt ?? null,
    lastRunMessageCount: latestRun?.messageCount ?? null,
    lastRunProductCount: latestRun?.productCount ?? null,
    lastRunInsightScore: latestRun?.insightScore ?? null,

    // Shopify API probes — separate so products and orders errors are visible independently
    probes: { products: productsProbe, orders: ordersProbe },

    // Most recent bulk publish job
    lastBulkJob: recentJob
      ? {
          id: (recentJob as { id: string }).id,
          status: (recentJob as { status: string }).status,
          processedItems: (recentJob as { processedItems: number }).processedItems,
          failedItems: (recentJob as { failedItems: number }).failedItems,
          error: (recentJob as { error?: string | null }).error ?? null,
          createdAt: (recentJob as { createdAt: Date }).createdAt,
        }
      : null,

    // Scope diagnostics
    scopeMatrix: {
      "read_products": grantedScopeList.includes("read_products"),
      "write_products": grantedScopeList.includes("write_products"),
      "read_orders": grantedScopeList.includes("read_orders"),
      "read_content": grantedScopeList.includes("read_content"),
      "write_content": grantedScopeList.includes("write_content"),
    },

    // Instructions when issues detected
    syncInstructions: productCount === 0
      ? "Products = 0. If scopes look correct, trigger a manual sync from the import page or wait for auto-sync on next dashboard load."
      : null,
    reauthorizeInstructions: missingScopes(grantedScopes, CONTENT_PUBLISH_SCOPES).length > 0
      ? "write_content is missing. Update shopify.app.production.toml, redeploy, then reinstall or reauthorize the app in Shopify Admin."
      : null,
  });
}

export default function ShopifyDebug() {
  const data = useLoaderData<typeof loader>();
  return (
    <pre style={{ padding: 24, whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 13 }}>
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
