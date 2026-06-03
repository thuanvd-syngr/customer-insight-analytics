import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

import prisma from "~/db.server";
import { REQUIRED_APP_SCOPES, REQUIRED_SYNC_SCOPES, SCOPE_IMPLIED_BY, getMissingFromRequired } from "~/lib/scope-guard.server";
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

  const scopeMatrix = Array.from(REQUIRED_APP_SCOPES).map((scope) => {
    const impliedBy = SCOPE_IMPLIED_BY[scope] ?? null;
    const directlyGranted = grantedScopeList.includes(scope);
    const satisfiedByImplication = !directlyGranted && impliedBy !== null && grantedScopeList.includes(impliedBy);
    return {
      scope,
      directlyGranted,
      satisfiedBy: satisfiedByImplication ? impliedBy : null,
      satisfied: directlyGranted || satisfiedByImplication,
    };
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
      scopeMatrix,
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
        `Click the reauthorize link below to clear the stale session and trigger a fresh OAuth grant.`
      : "Session scopes look correct.",
    reauthorizeUrl: missingRequired.length > 0
      ? `/auth/reauthorize?shop=${encodeURIComponent(session.shop)}`
      : null,
  });
}

export default function ShopifyAuthDebug() {
  const data = useLoaderData<typeof loader>();
  return (
    <div style={{ padding: 24, fontFamily: "monospace", fontSize: 13, lineHeight: 1.5 }}>
      {data.reauthorizeUrl && (
        <div style={{ marginBottom: 16, padding: 12, background: "#fff3cd", border: "1px solid #ffc107", borderRadius: 4 }}>
          <strong>Session is stale — scopes missing.</strong>{" "}
          <a href={data.reauthorizeUrl} style={{ color: "#0070f3" }}>
            Click here to clear the stale session and reauthorize
          </a>{" "}
          (clears all Session rows for this shop, then starts a fresh OAuth grant).
        </div>
      )}
      <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
