export const ACTION_TIMEOUT_MS = 5 * 60 * 1000;

export function makeActionKey(actionType: string, id?: string | null): string {
  return id ? `${actionType}:${id}` : actionType;
}

export function formActionKey(formData: FormData | URLSearchParams | null | undefined): string | null {
  const value = formData?.get("actionKey");
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function isActionLoading(input: {
  navigationState: string;
  formData?: FormData | URLSearchParams | null;
  actionKey: string;
  pendingActionKey?: string | null;
}): boolean {
  if (input.navigationState === "idle") return false;
  return formActionKey(input.formData) === input.actionKey || input.pendingActionKey === input.actionKey;
}

export function actionTimedOut(startedAt: number | null, now: number, timeoutMs = ACTION_TIMEOUT_MS): boolean {
  return startedAt !== null && now - startedAt >= timeoutMs;
}

export function extractShopifyNumericId(gidOrId: string | null | undefined): string | null {
  if (!gidOrId) return null;
  const decoded = safeDecodeURIComponent(gidOrId);
  const match = decoded.match(/(?:gid:\/\/shopify\/Product\/)?(\d+)$/);
  return match?.[1] ?? null;
}

export function shopAdminProductUrl(shopDomain: string, gidOrId: string | null | undefined): string | null {
  const numericId = extractShopifyNumericId(gidOrId);
  if (!numericId) return null;
  const shopSlug = shopDomain.replace(/\.myshopify\.com$/i, "");
  return `https://admin.shopify.com/store/${shopSlug}/products/${numericId}`;
}

export function productRecoveryPath(productIdOrTitle: string): string {
  return `/app/products/${encodeURIComponent(productIdOrTitle)}/recovery`;
}

export function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseShopifyScopes(scopeString: string | null | undefined): Set<string> {
  return new Set(
    (scopeString ?? "")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
  );
}

// Shopify grants write_products/write_content and omits the corresponding read_*
// scopes because write implies read. Mirror the same rules here so that loaders
// and action guards that call missingScopes() don't produce false positives.
const SCOPE_IMPLIED_BY: Record<string, string> = {
  read_products: "write_products",
  read_content: "write_content",
};

export function missingScopes(grantedScopes: string | null | undefined, requiredScopes: string[]): string[] {
  const granted = parseShopifyScopes(grantedScopes);
  return requiredScopes.filter((scope) => {
    if (granted.has(scope)) return false;
    const impliedBy = SCOPE_IMPLIED_BY[scope];
    return !(impliedBy && granted.has(impliedBy));
  });
}

export const CONTENT_PUBLISH_SCOPES = ["read_content", "write_content"];
export const PRODUCT_FAQ_PUBLISH_SCOPES = ["read_products", "write_products"];
