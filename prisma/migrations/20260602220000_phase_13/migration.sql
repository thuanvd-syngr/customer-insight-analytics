-- Phase 13: Production Hardening — add UsageEvent table for feature analytics.
-- Additive only: no existing tables modified, no columns dropped.

CREATE TABLE IF NOT EXISTS "UsageEvent" (
    "id"         TEXT NOT NULL,
    "shopId"     TEXT NOT NULL,
    "featureId"  TEXT NOT NULL,
    "metadata"   TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UsageEvent_shopId_featureId_idx"
    ON "UsageEvent"("shopId", "featureId");

CREATE INDEX IF NOT EXISTS "UsageEvent_shopId_occurredAt_idx"
    ON "UsageEvent"("shopId", "occurredAt");

ALTER TABLE "UsageEvent"
    ADD CONSTRAINT "UsageEvent_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
