-- Phases 5–11: BulkJob, BulkJobItem, EmailReportLog, ProductOptimizationDraft

CREATE TABLE "BulkJob" (
  "id"             TEXT NOT NULL,
  "shopId"         TEXT NOT NULL,
  "jobType"        TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'queued',
  "filterType"     TEXT,
  "totalItems"     INTEGER NOT NULL DEFAULT 0,
  "processedItems" INTEGER NOT NULL DEFAULT 0,
  "failedItems"    INTEGER NOT NULL DEFAULT 0,
  "resultJson"     TEXT,
  "error"          TEXT,
  "startedAt"      TIMESTAMP(3),
  "completedAt"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BulkJob_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BulkJob" ADD CONSTRAINT "BulkJob_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "BulkJob_shopId_status_idx" ON "BulkJob"("shopId", "status");
CREATE INDEX "BulkJob_shopId_createdAt_idx" ON "BulkJob"("shopId", "createdAt");

CREATE TABLE "BulkJobItem" (
  "id"         TEXT NOT NULL,
  "jobId"      TEXT NOT NULL,
  "itemId"     TEXT NOT NULL,
  "itemType"   TEXT NOT NULL,
  "status"     TEXT NOT NULL DEFAULT 'queued',
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "result"     TEXT,
  "error"      TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BulkJobItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BulkJobItem" ADD CONSTRAINT "BulkJobItem_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "BulkJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "BulkJobItem_jobId_status_idx" ON "BulkJobItem"("jobId", "status");

CREATE TABLE "EmailReportLog" (
  "id"             TEXT NOT NULL,
  "shopId"         TEXT NOT NULL,
  "reportType"     TEXT NOT NULL,
  "subject"        TEXT NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'pending',
  "provider"       TEXT NOT NULL DEFAULT 'mock',
  "error"          TEXT,
  "sentAt"         TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailReportLog_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EmailReportLog" ADD CONSTRAINT "EmailReportLog_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "EmailReportLog_shopId_createdAt_idx" ON "EmailReportLog"("shopId", "createdAt");
CREATE INDEX "EmailReportLog_shopId_reportType_idx" ON "EmailReportLog"("shopId", "reportType");

CREATE TABLE "ProductOptimizationDraft" (
  "id"              TEXT NOT NULL,
  "shopId"          TEXT NOT NULL,
  "productId"       TEXT NOT NULL,
  "productTitle"    TEXT NOT NULL,
  "sectionType"     TEXT NOT NULL,
  "originalContent" TEXT,
  "draftContent"    TEXT NOT NULL,
  "draftHtml"       TEXT NOT NULL,
  "source"          TEXT NOT NULL DEFAULT 'rule',
  "status"          TEXT NOT NULL DEFAULT 'draft',
  "publishedAt"     TIMESTAMP(3),
  "rolledBackAt"    TIMESTAMP(3),
  "error"           TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductOptimizationDraft_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProductOptimizationDraft" ADD CONSTRAINT "ProductOptimizationDraft_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ProductOptimizationDraft_shopId_productId_idx" ON "ProductOptimizationDraft"("shopId", "productId");
CREATE INDEX "ProductOptimizationDraft_shopId_status_idx" ON "ProductOptimizationDraft"("shopId", "status");
