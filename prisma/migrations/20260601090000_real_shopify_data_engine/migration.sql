-- Real Shopify Data Engine V1: product metadata, FAQ publishing state, weekly email storage.
ALTER TABLE IF EXISTS "ShopifyProduct" ADD COLUMN IF NOT EXISTS "tags" TEXT;
ALTER TABLE IF EXISTS "ShopifyProduct" ADD COLUMN IF NOT EXISTS "productType" TEXT;
ALTER TABLE IF EXISTS "ShopifyProduct" ADD COLUMN IF NOT EXISTS "collections" TEXT;

CREATE TABLE IF NOT EXISTS "GeneratedFaq" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "groupId" TEXT,
    "productId" TEXT,
    "productTitle" TEXT,
    "question" TEXT NOT NULL,
    "answerText" TEXT NOT NULL,
    "answerHtml" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'seo',
    "source" TEXT NOT NULL DEFAULT 'rule',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedFaq_pkey" PRIMARY KEY ("id")
);

ALTER TABLE IF EXISTS "GeneratedFaq" ADD COLUMN IF NOT EXISTS "publishTarget" TEXT NOT NULL DEFAULT 'metafield';
ALTER TABLE IF EXISTS "GeneratedFaq" ADD COLUMN IF NOT EXISTS "publishRef" TEXT;
ALTER TABLE IF EXISTS "GeneratedFaq" ADD COLUMN IF NOT EXISTS "previousHtml" TEXT;
ALTER TABLE IF EXISTS "GeneratedFaq" ADD COLUMN IF NOT EXISTS "error" TEXT;
ALTER TABLE IF EXISTS "GeneratedFaq" ADD COLUMN IF NOT EXISTS "rolledBackAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "GeneratedFaq_shopId_status_idx" ON "GeneratedFaq"("shopId", "status");
CREATE INDEX IF NOT EXISTS "GeneratedFaq_shopId_productId_idx" ON "GeneratedFaq"("shopId", "productId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'GeneratedFaq_shopId_fkey'
  ) THEN
    ALTER TABLE "GeneratedFaq" ADD CONSTRAINT "GeneratedFaq_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "WeeklyEmail" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "runId" TEXT,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'generated',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyEmail_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WeeklyEmail_shopId_generatedAt_idx" ON "WeeklyEmail"("shopId", "generatedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'WeeklyEmail_shopId_fkey'
  ) THEN
    ALTER TABLE "WeeklyEmail" ADD CONSTRAINT "WeeklyEmail_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
