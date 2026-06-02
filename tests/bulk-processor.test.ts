import { describe, expect, it, vi } from "vitest";

import {
  applyBulkFilter,
  processBulkJob,
  processItem,
  retryFailedItems,
  serializeJobResult,
  BULK_JOB_TYPE_LABELS,
  BULK_FILTER_LABELS,
  type BulkItem,
  type BulkJobResult,
} from "~/lib/bulk/processor";

const ITEMS: BulkItem[] = [
  { itemId: "shipping", itemType: "opportunity", label: "Shipping FAQ (high)" },
  { itemId: "product_abc", itemType: "product", label: "Test Board" },
  { itemId: "competitor_burton", itemType: "opportunity", label: "Competitor: Burton" },
  { itemId: "return", itemType: "opportunity", label: "Return policy" },
];

describe("applyBulkFilter", () => {
  it("returns all items when no filter", () => {
    expect(applyBulkFilter(ITEMS, undefined)).toHaveLength(4);
  });

  it("storewide keeps non-product opportunities", () => {
    const result = applyBulkFilter(ITEMS, "storewide");
    expect(result.every((i) => !i.itemId.startsWith("product_"))).toBe(true);
  });

  it("product filter keeps product items", () => {
    const result = applyBulkFilter(ITEMS, "product");
    expect(result.some((i) => i.itemId.startsWith("product_"))).toBe(true);
  });

  it("competitor filter keeps competitor items", () => {
    const result = applyBulkFilter(ITEMS, "competitor");
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]?.itemId).toContain("competitor");
  });

  it("high_impact filter keeps items with high/critical in label", () => {
    const result = applyBulkFilter(ITEMS, "high_impact");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]?.label).toMatch(/high|critical/i);
  });

  it("returns empty array for empty input", () => {
    expect(applyBulkFilter([], "storewide")).toHaveLength(0);
  });
});

describe("processItem", () => {
  it("returns completed on success", async () => {
    const handler = async (item: BulkItem) => `done:${item.itemId}`;
    const result = await processItem(ITEMS[0]!, handler);
    expect(result.status).toBe("completed");
    expect(result.result).toContain("shipping");
    expect(result.retryCount).toBe(0);
  });

  it("retries on failure and returns failed after maxRetries", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("network error"));
    const result = await processItem(ITEMS[0]!, handler, 0, 2);
    expect(result.status).toBe("failed");
    expect(result.error).toContain("network error");
    expect(handler).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("succeeds on retry after initial failure", async () => {
    let callCount = 0;
    const handler = async (item: BulkItem) => {
      callCount++;
      if (callCount === 1) throw new Error("transient");
      return `ok:${item.itemId}`;
    };
    const result = await processItem(ITEMS[0]!, handler, 0, 2);
    expect(result.status).toBe("completed");
  });
});

describe("processBulkJob", () => {
  it("processes all items and returns correct counts", async () => {
    const handler = async (item: BulkItem) => `done:${item.itemId}`;
    const result = await processBulkJob(
      { jobType: "generate", items: ITEMS },
      handler,
    );
    expect(result.totalItems).toBe(4);
    expect(result.processedItems).toBe(4);
    expect(result.failedItems).toBe(0);
  });

  it("applies filter before processing", async () => {
    const handler = async (item: BulkItem) => `done:${item.itemId}`;
    const result = await processBulkJob(
      { jobType: "generate", filterType: "competitor", items: ITEMS },
      handler,
    );
    expect(result.totalItems).toBeLessThan(ITEMS.length);
  });

  it("counts failed items correctly", async () => {
    const handler = async (_item: BulkItem) => { throw new Error("fail"); };
    const result = await processBulkJob(
      { jobType: "generate", items: ITEMS, maxRetries: 0 },
      handler,
    );
    expect(result.failedItems).toBe(result.totalItems);
    expect(result.processedItems).toBe(0);
  });

  it("calls onProgress callback", async () => {
    const progressUpdates: number[] = [];
    const handler = async (item: BulkItem) => item.itemId;
    await processBulkJob(
      { jobType: "generate", items: ITEMS, batchSize: 2 },
      handler,
      (done) => progressUpdates.push(done),
    );
    expect(progressUpdates.length).toBeGreaterThan(0);
  });

  it("respects batchSize", async () => {
    const concurrent: number[] = [];
    let running = 0;
    const handler = async (item: BulkItem) => {
      running++;
      concurrent.push(running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      return item.itemId;
    };
    await processBulkJob(
      { jobType: "generate", items: ITEMS, batchSize: 2 },
      handler,
    );
    expect(Math.max(...concurrent)).toBeLessThanOrEqual(2);
  });
});

describe("retryFailedItems", () => {
  it("retries only failed items", async () => {
    const previousResult: BulkJobResult = {
      jobType: "generate",
      totalItems: 2,
      processedItems: 1,
      failedItems: 1,
      durationMs: 0,
      results: [
        { itemId: "shipping", status: "completed", retryCount: 0, result: "ok" },
        { itemId: "return", status: "failed", retryCount: 2, error: "timeout" },
      ],
    };
    const handler = async (item: BulkItem) => `retried:${item.itemId}`;
    const result = await retryFailedItems(previousResult, ITEMS, handler);
    expect(result.failedItems).toBe(0);
    expect(result.processedItems).toBe(2);
  });
});

describe("serializeJobResult", () => {
  it("returns valid JSON string", () => {
    const result: BulkJobResult = {
      jobType: "publish_pages",
      totalItems: 5,
      processedItems: 4,
      failedItems: 1,
      durationMs: 1200,
      results: [],
    };
    const serialized = serializeJobResult(result);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    expect(parsed.jobType).toBe("publish_pages");
    expect(parsed.totalItems).toBe(5);
    expect(parsed.durationMs).toBe(1200);
  });
});

describe("BULK_JOB_TYPE_LABELS", () => {
  it("has a label for every job type", () => {
    const types = ["generate", "publish_pages", "publish_blogs", "publish_product_faqs", "export", "ignore"];
    for (const t of types) {
      expect(BULK_JOB_TYPE_LABELS[t as keyof typeof BULK_JOB_TYPE_LABELS]).toBeTruthy();
    }
  });
});

describe("BULK_FILTER_LABELS", () => {
  it("has a label for every filter type", () => {
    const filters = ["storewide", "product", "competitor", "high_impact", "not_published"];
    for (const f of filters) {
      expect(BULK_FILTER_LABELS[f as keyof typeof BULK_FILTER_LABELS]).toBeTruthy();
    }
  });
});
