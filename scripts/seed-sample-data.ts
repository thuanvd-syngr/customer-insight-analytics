import prisma from "../app/db.server";
import { runAnalysis } from "../app/lib/engine";
import {
  buildSampleAnalysisInput,
  filterNewSampleMessages,
  getSampleMessages,
  isSampleDataEnabled,
} from "../app/lib/sample-data";
import { saveInsightRun } from "../app/lib/shop.server";

if (process.env.NODE_ENV === "production" || !isSampleDataEnabled()) {
  console.log("Sample data seeding is disabled. Set ENABLE_SAMPLE_DATA=true outside production to enable it.");
  await prisma.$disconnect();
  process.exit(0);
}

const shopDomain = process.env.SEED_SHOP_DOMAIN ?? "dev-shop.myshopify.com";
const now = new Date();

const shop = await prisma.shop.upsert({
  where: { shopDomain },
  update: { uninstalledAt: null },
  create: { shopDomain },
});

const messages = getSampleMessages(now);
const existing = await prisma.importedMessage.findMany({
  where: {
    shopId: shop.id,
    externalId: { in: messages.map((message) => message.externalId).filter(Boolean) as string[] },
  },
  select: { externalId: true },
});
const missing = filterNewSampleMessages(
  messages,
  existing.map((message) => message.externalId),
);

if (missing.length > 0) {
  await prisma.importedMessage.createMany({
    data: missing.map((message) => ({
      shopId: shop.id,
      source: message.source,
      content: message.content,
      occurredAt: message.occurredAt,
      customerRef: message.customerRef,
      externalId: message.externalId,
    })),
  });
}

const result = runAnalysis(buildSampleAnalysisInput(now));
await saveInsightRun(prisma, shop.id, result);

console.log(
  `Seeded ${missing.length} new sample messages for ${shopDomain}. Score ${result.insightScore}, ${result.keywordGroups.length} groups.`,
);
await prisma.$disconnect();
