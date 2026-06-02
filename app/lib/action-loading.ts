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
  const decoded = decodeURIComponent(gidOrId);
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
