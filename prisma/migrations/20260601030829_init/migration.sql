-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "onboardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportedMessage" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT,
    "customerRef" TEXT,
    "content" TEXT NOT NULL,
    "rawMeta" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsightRun" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "insightScore" INTEGER NOT NULL DEFAULT 0,
    "windowDays" INTEGER NOT NULL DEFAULT 30,
    "summaryJson" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsightRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeywordFinding" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "prev7Count" INTEGER NOT NULL DEFAULT 0,
    "prev30Count" INTEGER NOT NULL DEFAULT 0,
    "trend7" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trend30" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "exampleQuote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeywordFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductFinding" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT,
    "productTitle" TEXT NOT NULL,
    "mentionCount" INTEGER NOT NULL DEFAULT 0,
    "confusionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "topGroups" TEXT,
    "exampleQuote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaqOpportunity" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "rationale" TEXT,
    "frequency" INTEGER NOT NULL DEFAULT 0,
    "hasContent" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaqOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyReport" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "runId" TEXT,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "insightScore" INTEGER NOT NULL DEFAULT 0,
    "dataJson" TEXT NOT NULL,
    "aiSummary" TEXT,
    "aiProvider" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageCounter" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");

-- CreateIndex
CREATE INDEX "Shop_shopDomain_idx" ON "Shop"("shopDomain");

-- CreateIndex
CREATE INDEX "ImportedMessage_shopId_occurredAt_idx" ON "ImportedMessage"("shopId", "occurredAt");

-- CreateIndex
CREATE INDEX "ImportedMessage_shopId_source_idx" ON "ImportedMessage"("shopId", "source");

-- CreateIndex
CREATE INDEX "InsightRun_shopId_createdAt_idx" ON "InsightRun"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "KeywordFinding_runId_groupId_idx" ON "KeywordFinding"("runId", "groupId");

-- CreateIndex
CREATE INDEX "KeywordFinding_shopId_groupId_idx" ON "KeywordFinding"("shopId", "groupId");

-- CreateIndex
CREATE INDEX "ProductFinding_runId_idx" ON "ProductFinding"("runId");

-- CreateIndex
CREATE INDEX "ProductFinding_shopId_idx" ON "ProductFinding"("shopId");

-- CreateIndex
CREATE INDEX "FaqOpportunity_runId_idx" ON "FaqOpportunity"("runId");

-- CreateIndex
CREATE INDEX "FaqOpportunity_shopId_groupId_idx" ON "FaqOpportunity"("shopId", "groupId");

-- CreateIndex
CREATE INDEX "WeeklyReport_shopId_weekStart_idx" ON "WeeklyReport"("shopId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_shopId_key_key" ON "AppSetting"("shopId", "key");

-- CreateIndex
CREATE INDEX "UsageCounter_shopId_idx" ON "UsageCounter"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "UsageCounter_shopId_metric_period_key" ON "UsageCounter"("shopId", "metric", "period");

-- AddForeignKey
ALTER TABLE "ImportedMessage" ADD CONSTRAINT "ImportedMessage_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsightRun" ADD CONSTRAINT "InsightRun_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordFinding" ADD CONSTRAINT "KeywordFinding_runId_fkey" FOREIGN KEY ("runId") REFERENCES "InsightRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFinding" ADD CONSTRAINT "ProductFinding_runId_fkey" FOREIGN KEY ("runId") REFERENCES "InsightRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaqOpportunity" ADD CONSTRAINT "FaqOpportunity_runId_fkey" FOREIGN KEY ("runId") REFERENCES "InsightRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSetting" ADD CONSTRAINT "AppSetting_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageCounter" ADD CONSTRAINT "UsageCounter_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
