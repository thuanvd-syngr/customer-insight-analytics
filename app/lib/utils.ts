/** Maximum number of messages loaded into memory for a single analysis pass. */
export const ANALYSIS_MESSAGE_LIMIT = 10_000;

/**
 * Process an array of items in sequential batches of `batchSize`.
 * Each batch runs concurrently; batches run one after another.
 * Prevents connection-pool exhaustion when upserting hundreds of rows.
 */
export async function processInBatches<T>(
  items: T[],
  batchSize: number,
  handler: (item: T) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    await Promise.all(items.slice(i, i + batchSize).map(handler));
  }
}

export function parseStringArray(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
