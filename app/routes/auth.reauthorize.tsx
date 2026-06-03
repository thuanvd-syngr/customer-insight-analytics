import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";

import prisma from "~/db.server";

export function isValidShopDomain(shop: string): boolean {
  return /^[a-zA-Z0-9-]+\.myshopify\.com$/.test(shop);
}

/**
 * Clears all stale Session rows for a shop, then redirects to /auth/login
 * which calls shopify.login() to initiate a fresh OAuth grant.
 *
 * Why /auth/login and not /auth: authenticate.admin() (used in auth.$.tsx)
 * is designed for the embedded-app iframe context. Outside that context,
 * with the session deleted, it returns null instead of starting OAuth.
 * shopify.login() reads the shop from the URL query param and always
 * redirects to Shopify's OAuth URL when the shop is present and valid.
 *
 * Why delete sessions first: PrismaSessionStorage returns the cached
 * offline_<shop> row unchanged even after a reinstall, so OAuth is never
 * re-triggered. Deleting the rows forces a clean OAuth start.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") ?? "";

  if (!isValidShopDomain(shop)) {
    throw new Response("Invalid shop domain", { status: 400 });
  }

  const deleted = await prisma.session.deleteMany({ where: { shop } });
  const redirectTarget = `/auth/login?shop=${encodeURIComponent(shop)}`;

  console.info("[reauthorize] Cleared stale sessions, redirecting to OAuth", {
    shop,
    clearedCount: deleted.count,
    redirectTarget,
  });

  throw redirect(redirectTarget);
}
