import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

import prisma from "~/db.server";
import { REQUIRED_APP_SCOPES, REQUIRED_SYNC_SCOPES, getMissingFromRequired } from "~/lib/scope-guard.server";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const envScopes = process.env.SCOPES ?? null;
  const envScopeList = envScopes ? envScopes.split(",").map((s) => s.trim()).filter(Boolean) : [];

  const grantedScopes = session.scope ?? "";
  const grantedScopeList = grantedScopes.split(",").map((s) => s.trim()).filter(Boolean);

  const missingRequired = getMissingFromRequired(grantedScopes, REQUIRED_APP_SCOPES);
  const missingSyncScopes = getMissingFromRequired(grantedScopes, REQUIRED_SYNC_SCOPES);
  const missingFromEnv = getMissingFromRequired(grantedScopes, envScopeList);

  // Recent sessions for this shop — shows scope history across installs.
  // Access token is intentionally excluded.
  const sessions = await prisma.session.findMany({
    where: { shop: session.shop },
    orderBy: { expires: "desc" },
    take: 5,
    select: {
      id: true,
      shop: true,
      scope: true,
      isOnline: true,
      expires: true,
      userId: true,
    },
  });

  const scopeMatch = {
    envVsRequired: {
      envScopes: envScopeList,
      requiredAppScopes: Array.from(REQUIRED_APP_SCOPES),
      inEnvButNotRequired: envScopeList.filter((s) => !REQUIRED_APP_SCOPES.includes(s as never)),
      inRequiredButNotEnv: Array.from(REQUIRED_APP_SCOPES).filter((s) => !envScopeList.includes(s)),
    },
    sessionVsRequired: {
      granted: grantedScopeList,
      missingRequired,
      missingSyncScopes,
      missingFromEnv,
      sessionHealthy: missingRequired.length === 0,
    },
  };

  return json({
    shop: session.shop,
    sessionId: session.id,
    isOnline: session.isOnline,
    expires: session.expires,

    envScopes: envScopes ?? "(SCOPES env var not set — authenticate.admin will not enforce scopes)",
    grantedScopes: grantedScopes || "(none)",

    scopeMatch,

    recentSessions: sessions.map((s) => ({
      id: s.id,
      shop: s.shop,
      scope: s.scope ?? "(none)",
      isOnline: s.isOnline,
      expires: s.expires,
      userId: s.userId !== null ? String(s.userId) : null,
    })),

    instructions: missingRequired.length > 0
      ? `Session is stale. Missing: ${missingRequired.join(", ")}. ` +
        `Uninstall the app from Shopify Admin → Apps → Customer Insight Analytics → Uninstall, ` +
        `then reinstall to trigger a fresh OAuth grant.`
      : "Session scopes look correct.",
  });
}

export default function ShopifyAuthDebug() {
  const data = useLoaderData<typeof loader>();
  return (
    <pre style={{ padding: 24, whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 13, lineHeight: 1.5 }}>
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
