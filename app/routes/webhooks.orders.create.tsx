import type { ActionFunctionArgs } from "@remix-run/node";

import prisma from "~/db.server";
import { ensureShop } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";
import { getDelegate } from "~/lib/prisma-safe";

interface ShopifyOrderPayload {
  id?: number;
  name?: string;
  note?: string;
  tags?: string;
  customer?: { id?: number; email?: string };
  processed_at?: string;
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { shop, payload } = await authenticate.webhook(request);
    if (!shop || !payload) return new Response(null, { status: 200 });

    const shopRecord = await ensureShop(prisma, shop);
    const data = payload as ShopifyOrderPayload;
    if (!data.id) return new Response(null, { status: 200 });

    const externalId = String(data.id);

    // Upsert order snapshot
    const orderDelegate = getDelegate(prisma, "shopifyOrder");
    if (orderDelegate?.upsert) {
      await orderDelegate.upsert({
        where: { shopId_externalId: { shopId: shopRecord.id, externalId } },
        update: {
          name: data.name ?? null,
          note: data.note ?? null,
          tags: data.tags ?? null,
          processedAt: data.processed_at ? new Date(data.processed_at) : null,
          syncedAt: new Date(),
        },
        create: {
          shopId: shopRecord.id,
          externalId,
          name: data.name ?? null,
          note: data.note ?? null,
          tags: data.tags ?? null,
          customerRef: data.customer?.id ? String(data.customer.id) : null,
          processedAt: data.processed_at ? new Date(data.processed_at) : null,
          syncedAt: new Date(),
        },
      });
    }

    // If order has a note, create an ImportedMessage so next analysis picks it up
    if (data.note?.trim()) {
      const messageDelegate = getDelegate(prisma, "importedMessage");
      if (messageDelegate?.upsert) {
        try {
          await messageDelegate.upsert({
            where: { shopId_externalId: { shopId: shopRecord.id, externalId: `order_note_${externalId}` } },
            update: {},
            create: {
              shopId: shopRecord.id,
              source: "order_note",
              externalId: `order_note_${externalId}`,
              content: data.note.trim(),
              occurredAt: data.processed_at ? new Date(data.processed_at) : new Date(),
            },
          });
        } catch {
          // Duplicate — skip silently
        }
      }
    }

    console.log(`[webhook] orders/create — synced order ${externalId} for ${shop}`);
  } catch (error) {
    console.error("[webhook] orders/create failed", error);
  }
  return new Response(null, { status: 200 });
}

export function loader() {
  return new Response(null, { status: 200 });
}
