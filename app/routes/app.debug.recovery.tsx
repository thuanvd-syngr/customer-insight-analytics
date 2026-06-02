import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

import prisma from "~/db.server";
import { messageMatchesProduct } from "~/lib/engine/product-confusion";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { EMPTY_INSIGHT, type NormalizedMessage, type ProductInput } from "~/lib/types";
import { parseStringArray } from "~/lib/utils";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  const [messages, products, latestRun] = await Promise.all([
    prisma.importedMessage.findMany({
      where: { shopId: shop.id },
      orderBy: { occurredAt: "desc" },
      take: 10000,
    }),
    prisma.shopifyProduct.findMany({
      where: { shopId: shop.id },
      orderBy: { syncedAt: "desc" },
      take: 1000,
    }),
    getLatestRun(prisma, shop.id),
  ]);
  const insight = parseRun(latestRun) ?? EMPTY_INSIGHT;
  const normalizedMessages: NormalizedMessage[] = messages.map((message) => ({
    id: message.id,
    content: message.content,
    occurredAt: message.occurredAt,
    source: message.source,
    customerRef: message.customerRef,
    externalId: message.externalId,
  }));
  const productInputs: ProductInput[] = products.map((product) => ({
    id: product.externalId,
    title: product.title,
    handle: product.handle ?? undefined,
    vendor: product.vendor,
    description: product.description ?? "",
    tags: parseStringArray(product.tags),
    productType: product.productType,
    collections: parseStringArray(product.collections),
    updatedAt: product.shopifyUpdatedAt,
  }));
  const matchedMessageIds = new Set<string>();
  for (const message of normalizedMessages) {
    if (productInputs.some((product) => messageMatchesProduct(message, product))) {
      matchedMessageIds.add(message.id);
    }
  }

  return json({
    shop: shop.shopDomain,
    latestRunId: latestRun?.id ?? null,
    questionsImported: messages.length,
    productsSynced: products.length,
    matchedQuestions: matchedMessageIds.size,
    unmatchedQuestions: Math.max(0, messages.length - matchedMessageIds.size),
    storewideFindings: insight.storewideOpportunities.length,
    productFindings: insight.contentGaps.length + insight.productConfusion.length,
    competitorMentions: insight.competitors.reduce((sum, item) => sum + item.count, 0),
    examples: {
      storewide: insight.storewideOpportunities.slice(0, 5).map((item) => ({
        code: item.code,
        groupId: item.groupId,
        label: item.label,
        mentions: item.mentionCount,
        action: item.suggestedAction,
      })),
      product: insight.contentGaps.slice(0, 5).map((item) => ({
        productId: item.productId,
        productTitle: item.productTitle,
        mentions: item.mentionCount,
        missingSections: item.missingSections,
      })),
      competitors: insight.competitors.slice(0, 5),
    },
  });
}

export default function RecoveryDebug() {
  const data = useLoaderData<typeof loader>();
  return (
    <pre style={{ padding: 24, whiteSpace: "pre-wrap" }}>
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
