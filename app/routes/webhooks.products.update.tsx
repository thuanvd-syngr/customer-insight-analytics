import type { ActionFunctionArgs } from "@remix-run/node";

import prisma from "~/db.server";
import { ensureShop } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";
import { getDelegate } from "~/lib/prisma-safe";

interface ShopifyProductPayload {
  id?: number;
  title?: string;
  handle?: string;
  body_html?: string;
  vendor?: string;
  tags?: string;
  product_type?: string;
  updated_at?: string;
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { shop, payload } = await authenticate.webhook(request);
    if (!shop || !payload) return new Response(null, { status: 200 });

    const shopRecord = await ensureShop(prisma, shop);
    const data = payload as ShopifyProductPayload;
    if (!data.id) return new Response(null, { status: 200 });

    const externalId = String(data.id);
    const productDelegate = getDelegate(prisma, "shopifyProduct");
    if (productDelegate?.update) {
      try {
        await productDelegate.update({
          where: { shopId_externalId: { shopId: shopRecord.id, externalId } },
          data: {
            title: data.title ?? undefined,
            handle: data.handle ?? undefined,
            description: data.body_html ?? undefined,
            vendor: data.vendor ?? undefined,
            tags: data.tags ?? undefined,
            productType: data.product_type ?? undefined,
            shopifyUpdatedAt: data.updated_at ? new Date(data.updated_at) : undefined,
            syncedAt: new Date(),
          },
        });
      } catch {
        // Product not in local DB yet — upsert
        if (productDelegate?.upsert) {
          await productDelegate.upsert({
            where: { shopId_externalId: { shopId: shopRecord.id, externalId } },
            update: { syncedAt: new Date() },
            create: {
              shopId: shopRecord.id,
              externalId,
              title: data.title ?? "",
              handle: data.handle ?? null,
              description: data.body_html ?? "",
              vendor: data.vendor ?? null,
              tags: data.tags ?? "",
              productType: data.product_type ?? null,
              shopifyUpdatedAt: data.updated_at ? new Date(data.updated_at) : null,
              syncedAt: new Date(),
            },
          });
        }
      }
    }

    console.log(`[webhook] products/update — synced product ${externalId} for ${shop}`);
  } catch (error) {
    console.error("[webhook] products/update failed", error);
  }
  return new Response(null, { status: 200 });
}

export function loader() {
  return new Response(null, { status: 200 });
}
