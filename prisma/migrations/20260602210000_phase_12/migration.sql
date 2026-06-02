-- Phase 12: AI Revenue Copilot + Content Library + Revenue Timeline + Auto-Publish + Marketing Assets
-- All tables are additive; no existing tables are modified.

CREATE TABLE IF NOT EXISTS "CopilotMessage" (
  "id"         TEXT             NOT NULL PRIMARY KEY,
  "shopId"     TEXT             NOT NULL,
  "role"       TEXT             NOT NULL,
  "content"    TEXT             NOT NULL,
  "context"    TEXT,
  "sessionRef" TEXT,
  "topic"      TEXT,
  "confidence" INTEGER          NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CopilotMessage_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "CopilotMessage_shopId_createdAt_idx" ON "CopilotMessage"("shopId", "createdAt");
CREATE INDEX IF NOT EXISTS "CopilotMessage_shopId_sessionRef_idx" ON "CopilotMessage"("shopId", "sessionRef");

CREATE TABLE IF NOT EXISTS "ContentLibraryItem" (
  "id"         TEXT             NOT NULL PRIMARY KEY,
  "shopId"     TEXT             NOT NULL,
  "itemType"   TEXT             NOT NULL,
  "title"      TEXT             NOT NULL,
  "content"    TEXT             NOT NULL,
  "tags"       TEXT,
  "groupId"    TEXT,
  "productId"  TEXT,
  "source"     TEXT             NOT NULL DEFAULT 'generated',
  "status"     TEXT             NOT NULL DEFAULT 'active',
  "usageCount" INTEGER          NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3)     NOT NULL,
  CONSTRAINT "ContentLibraryItem_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ContentLibraryItem_shopId_itemType_idx" ON "ContentLibraryItem"("shopId", "itemType");
CREATE INDEX IF NOT EXISTS "ContentLibraryItem_shopId_status_idx"   ON "ContentLibraryItem"("shopId", "status");
CREATE INDEX IF NOT EXISTS "ContentLibraryItem_shopId_groupId_idx"  ON "ContentLibraryItem"("shopId", "groupId");

CREATE TABLE IF NOT EXISTS "RevenueEvent" (
  "id"           TEXT             NOT NULL PRIMARY KEY,
  "shopId"       TEXT             NOT NULL,
  "eventType"    TEXT             NOT NULL,
  "description"  TEXT             NOT NULL,
  "refId"        TEXT,
  "refType"      TEXT,
  "lowEstimate"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "highEstimate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "actualValue"  DOUBLE PRECISION,
  "occurredAt"   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"    TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RevenueEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "RevenueEvent_shopId_occurredAt_idx" ON "RevenueEvent"("shopId", "occurredAt");
CREATE INDEX IF NOT EXISTS "RevenueEvent_shopId_eventType_idx"  ON "RevenueEvent"("shopId", "eventType");

CREATE TABLE IF NOT EXISTS "AutoPublishRule" (
  "id"         TEXT             NOT NULL PRIMARY KEY,
  "shopId"     TEXT             NOT NULL,
  "ruleType"   TEXT             NOT NULL,
  "trigger"    TEXT             NOT NULL,
  "conditions" TEXT,
  "enabled"    BOOLEAN          NOT NULL DEFAULT false,
  "lastRunAt"  TIMESTAMP(3),
  "totalRuns"  INTEGER          NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3)     NOT NULL,
  CONSTRAINT "AutoPublishRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "AutoPublishRule_shopId_ruleType_key" ON "AutoPublishRule"("shopId", "ruleType");
CREATE INDEX        IF NOT EXISTS "AutoPublishRule_shopId_enabled_idx"   ON "AutoPublishRule"("shopId", "enabled");

CREATE TABLE IF NOT EXISTS "MarketingAsset" (
  "id"         TEXT             NOT NULL PRIMARY KEY,
  "shopId"     TEXT             NOT NULL,
  "assetType"  TEXT             NOT NULL,
  "platform"   TEXT             NOT NULL,
  "content"    TEXT             NOT NULL,
  "headline"   TEXT,
  "cta"        TEXT,
  "productId"  TEXT,
  "groupId"    TEXT,
  "tone"       TEXT             NOT NULL DEFAULT 'professional',
  "status"     TEXT             NOT NULL DEFAULT 'draft',
  "usageCount" INTEGER          NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3)     NOT NULL,
  CONSTRAINT "MarketingAsset_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "MarketingAsset_shopId_assetType_idx" ON "MarketingAsset"("shopId", "assetType");
CREATE INDEX IF NOT EXISTS "MarketingAsset_shopId_platform_idx"  ON "MarketingAsset"("shopId", "platform");
CREATE INDEX IF NOT EXISTS "MarketingAsset_shopId_status_idx"    ON "MarketingAsset"("shopId", "status");
