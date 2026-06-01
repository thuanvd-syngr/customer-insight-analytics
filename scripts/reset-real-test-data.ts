import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Delegate = {
  deleteMany?: (args?: Record<string, unknown>) => Promise<{ count: number }>;
  findMany?: (args?: Record<string, unknown>) => Promise<Array<{ id: string; shopDomain?: string }>>;
  updateMany?: (args?: Record<string, unknown>) => Promise<{ count: number }>;
};

type Args = {
  yes: boolean;
  includeUsage: boolean;
  shopDomain?: string;
};

const DELETE_ORDER = [
  "weeklyEmail",
  "weeklyReport",
  "generatedFaq",
  "faqOpportunity",
  "productFinding",
  "keywordFinding",
  "insightRun",
  "importedMessage",
  "shopifyOrder",
  "shopifyProduct",
  "shopifyCustomer",
] as const;

const LEGACY_DEMO_COMPETITORS = "Amazon\nTemu\nWalmart\nTarget\nTikTok Shop";

function parseArgs(argv: string[]): Args {
  const args: Args = { yes: false, includeUsage: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--yes") args.yes = true;
    if (arg === "--include-usage") args.includeUsage = true;
    if (arg.startsWith("--shop=")) args.shopDomain = arg.slice("--shop=".length);
    if (arg === "--shop") {
      const value = argv[index + 1];
      if (value) {
        args.shopDomain = value;
        index += 1;
      }
    }
  }
  return args;
}

function getDelegate(modelName: string): Delegate | null {
  const delegate = (prisma as unknown as Record<string, unknown>)[modelName];
  if (!delegate || typeof delegate !== "object") {
    console.warn(`Skipping ${modelName}: Prisma delegate unavailable.`);
    return null;
  }
  return delegate as Delegate;
}

async function shopFilter(shopDomain?: string): Promise<Record<string, unknown> | undefined> {
  if (!shopDomain) return undefined;
  const shops = await prisma.shop.findMany({
    where: { shopDomain },
    select: { id: true, shopDomain: true },
  });
  if (shops.length === 0) {
    console.log(`No Shop row found for ${shopDomain}. Nothing to reset.`);
    return { shopId: "__no_matching_shop__" };
  }
  return { shopId: { in: shops.map((shop) => shop.id) } };
}

async function deleteModel(modelName: string, where?: Record<string, unknown>): Promise<number> {
  const delegate = getDelegate(modelName);
  if (!delegate?.deleteMany) return 0;
  const result = await delegate.deleteMany(where ? { where } : undefined);
  return result.count;
}

async function sanitizeDemoSettings(where?: Record<string, unknown>): Promise<number> {
  const appSetting = getDelegate("appSetting");
  if (!appSetting?.updateMany) return 0;
  const settingWhere = {
    ...(where ?? {}),
    key: "competitorTerms",
    value: LEGACY_DEMO_COMPETITORS,
  };
  const result = await appSetting.updateMany({
    where: settingWhere,
    data: { value: "" },
  });
  return result.count;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (process.env.NODE_ENV === "production" && !args.yes) {
    throw new Error("Refusing to reset production data without --yes.");
  }

  console.log("Resetting real-test data. Session, Shop, AppSetting, and migration history will be preserved.");
  if (args.shopDomain) console.log(`Scope: ${args.shopDomain}`);
  const where = await shopFilter(args.shopDomain);
  const tables = args.includeUsage ? [...DELETE_ORDER, "usageCounter"] : DELETE_ORDER;

  for (const modelName of tables) {
    const count = await deleteModel(modelName, where);
    console.log(`${modelName}: deleted ${count}`);
  }
  const sanitized = await sanitizeDemoSettings(where);
  console.log(`appSetting: sanitized ${sanitized} legacy demo competitor setting(s)`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
