-- Safe migration: remove duplicate ImportedMessage rows, then add unique constraint.
--
-- Strategy: for each (shopId, externalId) pair where externalId IS NOT NULL,
-- keep the row with the latest createdAt and delete the rest.
-- PostgreSQL treats NULL as distinct from other NULLs, so rows with
-- externalId = NULL are unaffected and will not violate the new constraint.

DELETE FROM "ImportedMessage"
WHERE "externalId" IS NOT NULL
  AND id NOT IN (
    SELECT DISTINCT ON ("shopId", "externalId") id
    FROM "ImportedMessage"
    WHERE "externalId" IS NOT NULL
    ORDER BY "shopId", "externalId", "createdAt" DESC
  );

-- Add unique constraint. Prisma expects this exact constraint name.
ALTER TABLE "ImportedMessage"
  ADD CONSTRAINT "ImportedMessage_shopId_externalId_key" UNIQUE ("shopId", "externalId");
