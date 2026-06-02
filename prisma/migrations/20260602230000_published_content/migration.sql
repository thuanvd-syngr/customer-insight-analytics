-- Phase 15: Add PublishedContent table.
-- Additive only — no existing tables are modified.

CREATE TABLE IF NOT EXISTS "PublishedContent" (
  "id"            TEXT         NOT NULL PRIMARY KEY,
  "shopId"        TEXT         NOT NULL,
  "contentType"   TEXT         NOT NULL,
  "resourceId"    TEXT,
  "resourceTitle" TEXT         NOT NULL,
  "sourceId"      TEXT,
  "status"        TEXT         NOT NULL DEFAULT 'published',
  "error"         TEXT,
  "publishedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PublishedContent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "PublishedContent_shopId_contentType_idx" ON "PublishedContent"("shopId", "contentType");
CREATE INDEX IF NOT EXISTS "PublishedContent_shopId_publishedAt_idx" ON "PublishedContent"("shopId", "publishedAt");
