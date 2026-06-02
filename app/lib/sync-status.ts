type SyncStepResultLike = {
  ok: boolean;
  count: number;
  skipped?: boolean;
  reason?: string;
  error?: string;
};

export function productSyncStatusText(step: SyncStepResultLike): string {
  if (step.ok) return `Synced ${step.count} products`;
  if (step.skipped) return `Skipped: ${step.reason ?? "Product sync disabled"}`;
  return `Failed: ${step.error ?? step.reason ?? "Shopify API returned an error"}`;
}

export function orderSyncStatusText(step: SyncStepResultLike): string {
  if (step.ok && step.count === 0) return step.reason ?? "No orders found in this dev store.";
  if (step.ok) return `Synced ${step.count} orders`;
  if (step.skipped) return `Skipped: ${step.reason ?? "order access unavailable"}`;
  return `Failed: ${step.error ?? step.reason ?? "Shopify API returned an error"}`;
}
