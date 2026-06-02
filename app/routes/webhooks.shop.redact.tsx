import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

import prisma from "~/db.server";
import { cleanupShop } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";

// Mandatory Shopify GDPR webhook: shop/redact
// Sent 48 hours after a merchant uninstalls the app and requests full data deletion.
// We cascade-delete all shop data via cleanupShop (sessions → shop → all related data).
export async function action({ request }: ActionFunctionArgs) {
  const { topic, shop } = await authenticate.webhook(request);
  console.info("GDPR shop/redact received", { topic, shop });

  if (shop) {
    // cleanupShop uses deleteMany — safe to call even if shop was already removed
    // by the app/uninstalled webhook. deleteMany returns { count: 0 } if not found.
    const result = await cleanupShop(prisma, shop);
    console.info("GDPR shop/redact processed", { shop, ...result });
  }

  return new Response(null, { status: 200 });
}

export function loader(_args: LoaderFunctionArgs) {
  return new Response(null, { status: 200 });
}
