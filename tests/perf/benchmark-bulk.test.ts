// Performance benchmark: bulk processing engine (filter + serialize).
// Target: 1000 items filtered in < 50ms; 100 job serializations in < 30ms.

import { describe, expect, it } from "vitest";
import {
  applyBulkFilter,
  serializeJobResult,
  type BulkItem,
  type BulkJobResult,
} from "~/lib/bulk/processor";

function makeItems(count: number): BulkItem[] {
  const TYPES = ["opportunity", "faq", "product"] as const;
  const LABELS = ["high impact shipping", "critical return issue", "competitor mention", "low stock"];
  return Array.from({ length: count }, (_, i) => ({
    itemId: i % 3 === 0 ? `product_${i}` : i % 3 === 1 ? `competitor_${i}` : `pub_${i}`,
    itemType: TYPES[i % 3],
    label: LABELS[i % 4],
  }));
}

function makeJobResult(itemCount: number): BulkJobResult {
  return {
    jobType: "generate",
    totalItems: itemCount,
    processedItems: itemCount - 2,
    failedItems: 2,
    durationMs: 1234,
    results: Array.from({ length: itemCount }, (_, i) => ({
      itemId: `item-${i}`,
      status: i < itemCount - 2 ? "completed" : "failed",
      result: i < itemCount - 2 ? `Generated content for item ${i}` : undefined,
      error: i >= itemCount - 2 ? "Timed out" : undefined,
      retryCount: 0,
    })),
  };
}

describe("Bulk Engine — performance benchmarks", () => {
  it("applyBulkFilter (storewide): 1000 items < 10ms", () => {
    const items = makeItems(1000);
    const start = performance.now();
    const filtered = applyBulkFilter(items, "storewide");
    const elapsed = performance.now() - start;
    expect(filtered.length).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(10);
  });

  it("applyBulkFilter (competitor): 1000 items < 10ms", () => {
    const items = makeItems(1000);
    const start = performance.now();
    const filtered = applyBulkFilter(items, "competitor");
    const elapsed = performance.now() - start;
    expect(filtered.length).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(10);
  });

  it("applyBulkFilter (high_impact): 1000 items < 10ms", () => {
    const items = makeItems(1000);
    const start = performance.now();
    const filtered = applyBulkFilter(items, "high_impact");
    const elapsed = performance.now() - start;
    expect(filtered.length).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(10);
  });

  it("serializeJobResult: 500-item result < 20ms", () => {
    const result = makeJobResult(500);
    const start = performance.now();
    const json = serializeJobResult(result);
    const elapsed = performance.now() - start;
    expect(json.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(20);
  });

  it("100 filter+serialize cycles < 200ms", () => {
    const items = makeItems(500);
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      const filtered = applyBulkFilter(items, "product");
      serializeJobResult({
        jobType: "generate",
        totalItems: filtered.length,
        processedItems: filtered.length,
        failedItems: 0,
        durationMs: 100,
        results: filtered.map((item) => ({ itemId: item.itemId, status: "completed", retryCount: 0 })),
      });
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
  });
});
