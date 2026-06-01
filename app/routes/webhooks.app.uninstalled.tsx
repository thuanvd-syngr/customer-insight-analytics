import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

import prisma from "~/db.server";
import { cleanupShop } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";

export async function action({ request }: ActionFunctionArgs) {
  const { shop } = await authenticate.webhook(request);
  if (shop) await cleanupShop(prisma, shop);
  return new Response();
}

export function loader(_args: LoaderFunctionArgs) {
  return new Response(null, { status: 200 });
}
