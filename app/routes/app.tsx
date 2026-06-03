import type { LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { Banner, BlockStack } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { useEffect, useState } from "react";

import appStyles from "~/styles/app.css?url";
import { AppShell } from "~/components";
import { authenticate } from "~/shopify.server";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: polarisStyles },
  { rel: "stylesheet", href: appStyles },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return json({ apiKey: process.env.SHOPIFY_API_KEY || "" });
}

export default function EmbeddedApp() {
  const { apiKey } = useLoaderData<typeof loader>();
  // Detect client-side whether the app is running outside an iframe (i.e. not
  // inside Shopify Admin). The host param is only present on the initial load
  // and disappears on Remix client-side navigations — so it cannot be used as
  // a reliable embedded-vs-standalone signal after the first render.
  const [isOutsideAdmin, setIsOutsideAdmin] = useState(false);
  useEffect(() => {
    setIsOutsideAdmin(window.self === window.top);
  }, []);

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
    <AppShell>
      <Banner tone="critical" title="Embedded app navigation failed">
        <p>Refresh the app from Shopify Admin. Your store data is safe.</p>
      </Banner>
    </AppShell>
  );
}

export const headers = boundary.headers;
