import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";

import prisma from "~/db.server";
import { runAnalysis } from "~/lib/engine";
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

  const storedInsight = parseRun(latestRun) ?? EMPTY_INSIGHT;

  // Source breakdown — key for diagnosing filter issues (product_text/product_tags are excluded from analysis)
  const sourceCounts: Record<string, number> = {};
  for (const m of messages) sourceCounts[m.source] = (sourceCounts[m.source] ?? 0) + 1;

  const CATALOG_SOURCES = new Set(["product_text", "product_tags"]);
  const customerMessages = messages.filter((m) => !CATALOG_SOURCES.has(m.source));
  const catalogMessages = messages.filter((m) => CATALOG_SOURCES.has(m.source));

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

  // matchedQuestions counts only real customer messages (excludes catalog entries)
  const matchedMessageIds = new Set<string>();
  const normalizedCustomerMessages = normalizedMessages.filter((m) => !CATALOG_SOURCES.has(m.source));
  for (const message of normalizedCustomerMessages) {
    if (productInputs.some((product) => messageMatchesProduct(message, product))) {
      matchedMessageIds.add(message.id);
    }
  }

  // eligibleForAnalysis: messages that runAnalysis() will actually process
  // (product_text and product_tags are stripped before keyword matching)
  const eligibleMessages = normalizedMessages.filter(
    (m) => m.source !== "product_text" && m.source !== "product_tags",
  );

  // Run live analysis against current DB state — this is what the NEXT saveInsightRun would store
  const liveResult = runAnalysis({
    messages: normalizedMessages,
    products: productInputs,
    now: new Date(),
    windowDays: 30,
  });

  return json({
    shop: shop.shopDomain,
    latestRunId: latestRun?.id ?? null,
    latestRunAt: latestRun?.createdAt ?? null,

    // ── DB counts (live) ──────────────────────────────────────────────────────
    // questionsImported = real customer messages only (source NOT product_text/product_tags)
    // catalogEntries    = Shopify product catalog rows stored by sync (not customer questions)
    questionsImported: customerMessages.length,
    catalogEntries: catalogMessages.length,
    totalMessagesInDb: messages.length,
    productsSynced: products.length,
    matchedQuestions: matchedMessageIds.size,
    unmatchedQuestions: Math.max(0, customerMessages.length - matchedMessageIds.size),

    // ── Source breakdown ──────────────────────────────────────────────────────
    // If questionsImported is 0 and catalogEntries > 0, the shop has synced products
    // but hasn't imported any real customer questions yet.
    // If eligibleForAnalysis is 0, no customer questions exist in the analysis window.
    messageSources: sourceCounts,
    eligibleForAnalysis: eligibleMessages.length,

    // ── Live pipeline (what the NEXT run would produce right now) ─────────────
    live: {
      keywordGroupsDetected: liveResult.keywordGroups.map((g) => ({
        groupId: g.groupId,
        count: g.count,
        uniqueMessages: g.uniqueMessages,
      })),
      detectedTopics: liveResult.storewideOpportunities.map((o) => o.groupId),
      generatedStorewideOpportunities: liveResult.storewideOpportunities.map((o) => ({
        code: o.code,
        groupId: o.groupId,
        mentionCount: o.mentionCount,
        severity: o.severity,
      })),
      generatedProductOpportunities: liveResult.contentGaps.slice(0, 10).map((g) => ({
        productId: g.productId,
        productTitle: g.productTitle,
        missingSections: g.missingSections,
        contentGapScore: g.contentGapScore,
      })),
      storewideCount: liveResult.storewideOpportunities.length,
      productGapCount: liveResult.contentGaps.length,
      productConfusionCount: liveResult.productConfusion.length,
      questionOpportunitiesCount: liveResult.questionOpportunities.length,
    },

    // ── Persisted (last stored run) ───────────────────────────────────────────
    // Zero here after ec0548f typically means the stored run predates the feature.
    // Trigger auto-sync to create a fresh run.
    persisted: {
      persistedStorewideFindings: storedInsight.storewideOpportunities.length,
      persistedProductFindings: storedInsight.contentGaps.length + storedInsight.productConfusion.length,
      competitorMentions: storedInsight.competitors.reduce((sum, item) => sum + item.count, 0),
      storewide: storedInsight.storewideOpportunities.slice(0, 5).map((item) => ({
        code: item.code,
        groupId: item.groupId,
        label: item.label,
        mentions: item.mentionCount,
        action: item.suggestedAction,
      })),
      product: storedInsight.contentGaps.slice(0, 5).map((item) => ({
        productId: item.productId,
        productTitle: item.productTitle,
        mentions: item.mentionCount,
        missingSections: item.missingSections,
      })),
      competitors: storedInsight.competitors.slice(0, 5),
    },

    // ── Legacy compat fields (existing callers read these top-level) ──────────
    storewideFindings: storedInsight.storewideOpportunities.length,
    productFindings: storedInsight.contentGaps.length + storedInsight.productConfusion.length,
    competitorMentions: storedInsight.competitors.reduce((sum, item) => sum + item.count, 0),
    examples: {
      storewide: storedInsight.storewideOpportunities.slice(0, 5).map((item) => ({
        code: item.code,
        groupId: item.groupId,
        label: item.label,
        mentions: item.mentionCount,
        action: item.suggestedAction,
      })),
      product: storedInsight.contentGaps.slice(0, 5).map((item) => ({
        productId: item.productId,
        productTitle: item.productTitle,
        mentions: item.mentionCount,
        missingSections: item.missingSections,
      })),
      competitors: storedInsight.competitors.slice(0, 5),
    },
  });
}

export default function RecoveryDebug() {
  const data = useLoaderData<typeof loader>();
  return (
    <pre style={{ padding: 24, whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 13 }}>
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}
