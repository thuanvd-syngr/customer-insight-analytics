import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import prisma from "~/db.server";

function isValidShopDomain(shop: string): boolean {
  return /^[a-zA-Z0-9-]+\.myshopify\.com$/.test(shop);
}

/**
 * Clears all stale Session rows for a shop before forcing a fresh OAuth grant.
 *
 * Why this route exists: when session.scope is missing required scopes,
 * redirecting directly to /auth is not enough. authenticate.admin() finds the
 * existing offline_<shop> row in PrismaSessionStorage and returns it as-is —
 * Shopify never issues a new OAuth grant. Deleting the rows first ensures
 * authenticate.admin() sees no session and initiates the full OAuth flow.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") ?? "";

  if (!isValidShopDomain(shop)) {
    throw new Response("Invalid shop domain", { status: 400 });
  }

  const deleted = await prisma.session.deleteMany({ where: { shop } });

  console.info("[reauthorize] Cleared stale sessions, forcing fresh OAuth", {
    shop,
    clearedCount: deleted.count,
  });

  throw redirect(`/auth?shop=${encodeURIComponent(shop)}`);
}
