import { getDelegate } from "~/lib/prisma-safe";
import type { PrismaClient } from "@prisma/client";

/**
 * Safely write a UsageEvent. Never throws — if the migration has not been applied
 * or the delegate is absent, this is a silent no-op.
 */
export async function logUsage(
  db: PrismaClient,
  shopId: string,
  featureId: string,
  metadata?: Record<string, string | number | boolean> | null,
): Promise<void> {
  try {
    const usageEvent = getDelegate(db, "usageEvent");
    if (usageEvent?.create) {
      await usageEvent.create({
        data: {
          shopId,
          featureId,
          metadata: metadata ? JSON.stringify(metadata) : null,
        },
      });
    }
  } catch {
    // analytics must never crash the main action
  }
}
