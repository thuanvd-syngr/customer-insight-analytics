import { redirect } from "@remix-run/node";

export const REQUIRED_APP_SCOPES = [
  "read_products",
  "write_products",
  "read_orders",
  "read_content",
  "write_content",
] as const;

export const REQUIRED_SYNC_SCOPES = ["read_products", "read_orders"] as const;

// Shopify implicitly grants read access when the corresponding write scope is
// approved. Granting write_products also satisfies read_products usage, and
// write_content also satisfies read_content usage. This mirrors Shopify's own
// scope resolution so we do not false-positive on sessions that Shopify itself
// considers fully authorised.
export const SCOPE_IMPLIED_BY: Record<string, string> = {
  read_products: "write_products",
  read_content: "write_content",
};

type SessionLike = { shop: string; id: string; scope?: string | null };

function parseScopeSet(scopeStr: string | null | undefined): Set<string> {
  return new Set(
    (scopeStr ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  );
}

export function getMissingFromRequired(
  grantedScopeStr: string | null | undefined,
  required: readonly string[],
): string[] {
  const granted = parseScopeSet(grantedScopeStr);
  return Array.from(required).filter((s) => {
    if (granted.has(s)) return false;
    const impliedBy = SCOPE_IMPLIED_BY[s];
    return !(impliedBy && granted.has(impliedBy));
  });
}

export function hasRequiredScope(
  grantedScopeStr: string | null | undefined,
  scope: string,
): boolean {
  return getMissingFromRequired(grantedScopeStr, [scope]).length === 0;
}

/**
 * For loaders: throws a redirect to /auth when any required scope is missing.
 * The /auth route re-runs authenticate.admin() which detects the stale session
 * and initiates a fresh OAuth grant for the full scope set.
 *
 * IMPORTANT: callers inside a try-catch must re-throw Response objects:
 *   } catch (error) {
 *     if (error instanceof Response) throw error;
 *     ...
 *   }
 */
export function requireScopesOrRedirect(
  session: SessionLike,
  required: readonly string[] = REQUIRED_APP_SCOPES,
): void {
  const missing = getMissingFromRequired(session.scope, required);
  if (missing.length === 0) return;

  console.warn("[scope-guard] Stale session — missing required scopes, triggering reauth", {
    shop: session.shop,
    sessionId: session.id,
    grantedScopes: session.scope ?? "(none)",
    requiredScopes: Array.from(required),
    missingScopes: missing,
    reauth: true,
  });

  // Redirect to /auth/reauthorize rather than /auth directly. The reauthorize
  // route deletes all Session rows for the shop before redirecting to /auth,
  // which forces authenticate.admin() to start a fresh OAuth grant instead of
  // returning the cached stale offline session from PrismaSessionStorage.
  throw redirect(`/auth/reauthorize?shop=${encodeURIComponent(session.shop)}`);
}

/**
 * For actions: returns { ok: false, missing } instead of redirecting so the
 * UI can display an actionable error without losing the current page context.
 */
export function checkScopesForAction(
  session: SessionLike,
  required: readonly string[],
): { ok: true } | { ok: false; missing: string[] } {
  const missing = getMissingFromRequired(session.scope, required);
  if (missing.length === 0) return { ok: true };

  console.warn("[scope-guard] Action blocked — missing required scopes", {
    shop: session.shop,
    sessionId: session.id,
    grantedScopes: session.scope ?? "(none)",
    requiredScopes: Array.from(required),
    missingScopes: missing,
  });

  return { ok: false, missing };
}
