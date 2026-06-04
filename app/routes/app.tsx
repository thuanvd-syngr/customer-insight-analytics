import type { LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData, useNavigate, useRouteError } from "@remix-run/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { Banner, BlockStack } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { useEffect, useState } from "react";

import appStyles from "~/styles/app.css?url";
import { AppShell } from "~/components";
import { authenticate } from "~/shopify.server";

const SHOPIFY_EMBEDDED_CONTEXT_PARAMS = ["host", "id_token", "embedded", "hmac", "timestamp"];

export function isStandaloneAppRequest(request: Request) {
  const url = new URL(request.url);
  const isAppRoot = url.pathname === "/app" || url.pathname === "/app/";
  const hasShopifyContext = SHOPIFY_EMBEDDED_CONTEXT_PARAMS.some((param) => url.searchParams.has(param));
  const hasSessionCookie = Boolean(request.headers.get("Cookie"));
  const referrer = request.headers.get("Referer");
  const hasAppReferrer = referrer ? new URL(referrer).pathname.startsWith("/app") : false;
  return isAppRoot && !hasShopifyContext && !hasSessionCookie && !hasAppReferrer;
}

export function standaloneLoginUrl(request: Request) {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  return shop ? `/auth/login?shop=${encodeURIComponent(shop)}` : "/auth/login";
}

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: polarisStyles },
  { rel: "stylesheet", href: appStyles },
];

export async function loader({ request }: LoaderFunctionArgs) {
  if (isStandaloneAppRequest(request)) {
    throw redirect(standaloneLoginUrl(request));
  }
  await authenticate.admin(request);
  return json({ apiKey: process.env.SHOPIFY_API_KEY || "" });
}

export default function EmbeddedApp() {
  const { apiKey } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  // Detect client-side whether the app is running outside an iframe (i.e. not
  // inside Shopify Admin). The host param is only present on the initial load
  // and disappears on Remix client-side navigations — so it cannot be used as
  // a reliable embedded-vs-standalone signal after the first render.
  const [isOutsideAdmin, setIsOutsideAdmin] = useState(false);
  useEffect(() => {
    setIsOutsideAdmin(window.self === window.top);
  }, []);
  useEffect(() => {
    function handleAppLinkClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const target = event.target instanceof Element ? event.target.closest("a") : null;
      if (!(target instanceof HTMLAnchorElement)) return;
      if (target.target || target.hasAttribute("download")) return;
      const url = new URL(target.href, window.location.href);
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/app")) return;
      event.preventDefault();
      navigate(`${url.pathname}${url.search}${url.hash}`);
    }

    document.addEventListener("click", handleAppLinkClick, true);
    return () => document.removeEventListener("click", handleAppLinkClick, true);
  }, [navigate]);

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <a href="/app" rel="home">Dashboard</a>
        <a href="/app/recovery">Recovery Plan</a>
        <a href="/app/products">Products</a>
        <a href="/app/theme-audit">Theme Audit</a>
        <a href="/app/content">Content</a>
        <a href="/app/publish">Publish</a>
        <a href="/app/reports">Reports</a>
        <a href="/app/settings">Settings</a>
        <a href="/app/billing">Billing</a>
      </NavMenu>
      <AppShell>
        <BlockStack gap="400">
          {isOutsideAdmin ? (
            <Banner tone="info" title="Embedded navigation fallback active">
              <p>If this page was refreshed outside Shopify Admin, open the app from Shopify Admin to restore embedded navigation context.</p>
            </Banner>
          ) : null}
          <Outlet />
        </BlockStack>
      </AppShell>
    </AppProvider>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  console.error("Embedded app route error", error);
  return (
    <AppProvider isEmbeddedApp apiKey="">
      <AppShell>
        <Banner tone="critical" title="Embedded app navigation failed">
          <p>Refresh the app from Shopify Admin. Your store data is safe.</p>
        </Banner>
      </AppShell>
    </AppProvider>
  );
}

export const headers = boundary.headers;
