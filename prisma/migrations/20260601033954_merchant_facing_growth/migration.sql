-- CreateTable
CREATE TABLE "ShopifyProduct" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "description" TEXT,
    "rawJson" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyOrder" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT,
    "note" TEXT,
    "customerRef" TEXT,
    "tags" TEXT,
    "processedAt" TIMESTAMP(3),
    "rawJson" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyCustomer" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "displayName" TEXT,
    "emailHash" TEXT,
    "tags" TEXT,
    "note" TEXT,
    "rawJson" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShopifyProduct_shopId_title_idx" ON "ShopifyProduct"("shopId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyProduct_shopId_externalId_key" ON "ShopifyProduct"("shopId", "externalId");

-- CreateIndex
CREATE INDEX "ShopifyOrder_shopId_processedAt_idx" ON "ShopifyOrder"("shopId", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyOrder_shopId_externalId_key" ON "ShopifyOrder"("shopId", "externalId");

-- CreateIndex
CREATE INDEX "ShopifyCustomer_shopId_idx" ON "ShopifyCustomer"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyCustomer_shopId_externalId_key" ON "ShopifyCustomer"("shopId", "externalId");

-- AddForeignKey
ALTER TABLE "ShopifyProduct" ADD CONSTRAINT "ShopifyProduct_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyOrder" ADD CONSTRAINT "ShopifyOrder_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyCustomer" ADD CONSTRAINT "ShopifyCustomer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
