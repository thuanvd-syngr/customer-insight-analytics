/**
 * One-time repair: find any ImportedMessage rows with source="product_text" or
 * "product_tags" that were NOT created by Shopify product sync and update them
 * to source="manual".
 *
 * How to tell a sync record from a mis-classified customer question:
 *   syncShopifyData always sets externalId to "${productId}:description" or
 *   "${productId}:tags". Any record whose externalId does NOT match that pattern
 *   (or is null) was not created by sync and is almost certainly a mis-classified
 *   customer question.
 *
 * Usage (from project root, Node 22):
 *   npx tsx scripts/repair-imported-question-sources.ts [--dry-run] [--shop=<domain>]
 *
 * Add --dry-run to preview without writing.
 */

import prisma from "../app/db.server";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const shopArg = args.find((a) => a.startsWith("--shop="))?.split("=")[1];

const CATALOG_SOURCES = ["product_text", "product_tags"];

// Shopify sync externalId pattern: ends with ":description" or ":tags"
function isSyncRecord(externalId: string | null): boolean {
  if (!externalId) return false;
  return externalId.endsWith(":description") || externalId.endsWith(":tags");
}

async function main() {
  console.log(`Mode: ${dryRun ? "DRY RUN (no writes)" : "LIVE (will update DB)"}`);
  if (shopArg) console.log(`Filtering to shop: ${shopArg}`);

  const shopFilter = shopArg
    ? { shop: { shopDomain: shopArg } }
    : {};

  const candidates = await prisma.importedMessage.findMany({
    where: {
      source: { in: CATALOG_SOURCES },
      ...shopFilter,
    },
    select: {
      id: true,
      source: true,
      externalId: true,
      content: true,
      shopId: true,
    },
    orderBy: { id: "asc" },
  });

  const toRepair = candidates.filter((m) => !isSyncRecord(m.externalId));
  const legitimateSync = candidates.length - toRepair.length;

  console.log(`\nFound ${candidates.length} rows with source in [product_text, product_tags]:`);
  console.log(`  ${legitimateSync} are legitimate Shopify sync records (externalId ends in :description/:tags) — skipped`);
  console.log(`  ${toRepair.length} appear to be mis-classified customer questions — will repair`);

  if (toRepair.length === 0) {
    console.log("\nNothing to repair.");
    await prisma.$disconnect();
    return;
  }

  console.log("\nRecords to repair:");
  for (const m of toRepair.slice(0, 20)) {
    console.log(`  id=${m.id} source=${m.source} externalId=${m.externalId ?? "null"} content="${m.content.slice(0, 60)}..."`);
  }
  if (toRepair.length > 20) {
    console.log(`  ... and ${toRepair.length - 20} more`);
  }

  if (!dryRun) {
    const ids = toRepair.map((m) => m.id);
    const result = await prisma.importedMessage.updateMany({
      where: { id: { in: ids } },
      data: { source: "manual" },
    });
    console.log(`\nRepaired ${result.count} records (source → "manual").`);
  } else {
    console.log(`\nDry run complete. Run without --dry-run to apply changes.`);
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
