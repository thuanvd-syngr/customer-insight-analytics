// Bulk job processor — pure logic, no Prisma imports.
// Routes own DB persistence; this file is safe for unit tests.

export type BulkJobType =
  | "generate"
  | "publish_pages"
  | "publish_blogs"
  | "publish_product_faqs"
  | "export"
  | "ignore";

export type BulkFilterType =
  | "storewide"
  | "product"
  | "competitor"
  | "high_impact"
  | "not_published";

export type BulkItemStatus = "queued" | "running" | "completed" | "failed";

export type BulkJobStatus = "queued" | "running" | "completed" | "failed";

export interface BulkItem {
  itemId: string;
  itemType: "opportunity" | "faq" | "product";
  label?: string;
}

export interface BulkJobConfig {
  jobType: BulkJobType;
  filterType?: BulkFilterType;
  items: BulkItem[];
  /** Max concurrent items per batch. Defaults to 10. */
  batchSize?: number;
  /** Max retries per failed item. Defaults to 2. */
  maxRetries?: number;
}

export interface BulkItemResult {
  itemId: string;
  status: BulkItemStatus;
  result?: string;
  error?: string;
  retryCount: number;
}

export interface BulkJobResult {
  jobType: BulkJobType;
  totalItems: number;
  processedItems: number;
  failedItems: number;
  results: BulkItemResult[];
  durationMs: number;
}

export const BULK_JOB_TYPE_LABELS: Record<BulkJobType, string> = {
  generate: "Generate Content",
  publish_pages: "Publish FAQ Pages",
  publish_blogs: "Publish Blog Articles",
  publish_product_faqs: "Publish Product FAQs",
  export: "Export Data",
  ignore: "Mark as Resolved",
};

export const BULK_FILTER_LABELS: Record<BulkFilterType, string> = {
  storewide: "Storewide opportunities",
  product: "Product opportunities",
  competitor: "Competitor opportunities",
  high_impact: "High-impact only",
  not_published: "Not yet published",
};

/** Apply filterType to a list of items, returning only matching ones. */
export function applyBulkFilter(
  items: BulkItem[],
  filterType?: BulkFilterType,
): BulkItem[] {
  if (!filterType) return items;
  switch (filterType) {
    case "storewide":
      return items.filter((i) => i.itemType === "opportunity" && !i.itemId.startsWith("product_"));
    case "product":
      return items.filter((i) => i.itemType === "product" || i.itemId.startsWith("product_"));
    case "competitor":
      return items.filter((i) => i.itemId.startsWith("competitor_") || i.label?.toLowerCase().includes("competitor"));
    case "high_impact":
      // Convention: high-impact items have label containing "high" or "critical"
      return items.filter((i) => /high|critical/i.test(i.label ?? ""));
    case "not_published":
      return items.filter((i) => i.itemType !== "faq" || !i.itemId.startsWith("pub_"));
    default:
      return items;
  }
}

/**
 * Process a single item. Returns the result.
 * `handler` is injected by the caller — keeps this function pure and testable.
 */
export async function processItem(
  item: BulkItem,
  handler: (item: BulkItem) => Promise<string>,
  retryCount = 0,
  maxRetries = 2,
): Promise<BulkItemResult> {
  try {
    const result = await handler(item);
    return { itemId: item.itemId, status: "completed", result, retryCount };
  } catch (err) {
    if (retryCount < maxRetries) {
      return processItem(item, handler, retryCount + 1, maxRetries);
    }
    return {
      itemId: item.itemId,
      status: "failed",
      error: err instanceof Error ? err.message : "Unknown error",
      retryCount,
    };
  }
}

/**
 * Run all items through the handler in sequential batches of `batchSize`.
 * Never runs more than batchSize concurrent calls.
 */
export async function processBulkJob(
  config: BulkJobConfig,
  handler: (item: BulkItem) => Promise<string>,
  onProgress?: (done: number, total: number) => void,
): Promise<BulkJobResult> {
  const started = Date.now();
  const { items, batchSize = 10, maxRetries = 2, jobType } = config;
  const filtered = applyBulkFilter(items, config.filterType);
  const results: BulkItemResult[] = [];

  for (let i = 0; i < filtered.length; i += batchSize) {
    const batch = filtered.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((item) => processItem(item, handler, 0, maxRetries)),
    );
    results.push(...batchResults);
    onProgress?.(results.length, filtered.length);
  }

  const failedItems = results.filter((r) => r.status === "failed").length;

  return {
    jobType,
    totalItems: filtered.length,
    processedItems: results.filter((r) => r.status === "completed").length,
    failedItems,
    results,
    durationMs: Date.now() - started,
  };
}

/** Retry only failed items from a previous job result. */
export async function retryFailedItems(
  previousResult: BulkJobResult,
  allItems: BulkItem[],
  handler: (item: BulkItem) => Promise<string>,
): Promise<BulkJobResult> {
  const started = Date.now();
  const failedIds = new Set(
    previousResult.results.filter((r) => r.status === "failed").map((r) => r.itemId),
  );
  const toRetry = allItems.filter((i) => failedIds.has(i.itemId));
  const newResults = await Promise.all(
    toRetry.map((item) => processItem(item, handler, 0, 2)),
  );
  // Merge: replace failed results with new results
  const merged = previousResult.results.map((old) => {
    const replacement = newResults.find((r) => r.itemId === old.itemId);
    return replacement ?? old;
  });
  const failedItems = merged.filter((r) => r.status === "failed").length;
  return {
    ...previousResult,
    processedItems: merged.filter((r) => r.status === "completed").length,
    failedItems,
    results: merged,
    durationMs: Date.now() - started,
  };
}

/** Summarise a job result into a plain JSON string (stored in BulkJob.resultJson). */
export function serializeJobResult(result: BulkJobResult): string {
  return JSON.stringify({
    jobType: result.jobType,
    totalItems: result.totalItems,
    processedItems: result.processedItems,
    failedItems: result.failedItems,
    durationMs: result.durationMs,
  });
}
