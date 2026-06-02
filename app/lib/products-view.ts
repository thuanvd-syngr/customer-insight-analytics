import type { ContentGapAnalysis, ProductConfusionResult } from "~/lib/types";

export type ProductsPageState = "needs_sync" | "needs_analysis" | "no_findings" | "recovery";

export function getProductsPageState(input: {
  shopifyProductCount: number;
  productFindingCount: number;
  insightRunCount: number;
  products: ProductConfusionResult[];
  contentGaps?: ContentGapAnalysis[];
}): ProductsPageState {
  if (input.shopifyProductCount === 0) return "needs_sync";
  // Recovery view is available when direct confusion OR content-gap data exists.
  // contentGaps covers synced products even when no message directly names them.
  const hasData =
    input.products.length > 0 ||
    input.productFindingCount > 0 ||
    (input.contentGaps?.length ?? 0) > 0;
  if (hasData) return "recovery";
  if (input.insightRunCount === 0) return "needs_analysis";
  return "no_findings";
}

export function shouldShowSyncedProducts(input: { shopifyProductCount: number }): boolean {
  return input.shopifyProductCount > 0;
}
