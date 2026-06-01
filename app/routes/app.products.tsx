import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigation } from "@remix-run/react";
import { Badge, BlockStack, Button, InlineStack, Text } from "@shopify/polaris";

import {
  AppPage,
  EmptyStateCard,
  formatNumber,
  KpiCard,
  ListSkeleton,
  money,
  ProductRecoveryCard,
  SectionHeader,
} from "~/components";
import prisma from "~/db.server";
import { getProductsPageState } from "~/lib/products-view";
import { safeCount } from "~/lib/prisma-safe";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { EMPTY_INSIGHT } from "~/lib/types";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shop = await ensureShop(prisma, session.shop);
    const url = new URL(request.url);
    const debugMode = url.searchParams.get("debug");
    const showAnalysisDebug = debugMode === "analysis" && process.env.NODE_ENV !== "production";
    const showFindingsDebug = debugMode === "findings" && process.env.NODE_ENV !== "production";
    const [latestRun, shopifyProductCount, productFindingCount, insightRunCount, importedMessageCount, keywordFindingCount] = await Promise.all([
      getLatestRun(prisma, shop.id),
      safeCount(prisma, "shopifyProduct", { where: { shopId: shop.id } }),
      safeCount(prisma, "productFinding", { where: { shopId: shop.id } }),
      safeCount(prisma, "insightRun", { where: { shopId: shop.id, status: "completed" } }),
      safeCount(prisma, "importedMessage", { where: { shopId: shop.id } }),
      safeCount(prisma, "keywordFinding", { where: { shopId: shop.id } }),
    ]);
    const insight = parseRun(latestRun) ?? EMPTY_INSIGHT;

    // Latest generated finding payload (from summaryJson snapshot)
    const latestGeneratedFinding = insight.contentGaps.length > 0
      ? {
          productTitle: insight.contentGaps[0].productTitle,
          contentGapScore: insight.contentGaps[0].contentGapScore,
          missingSections: insight.contentGaps[0].missingSections,
          estimatedLow: insight.contentGaps[0].estimatedLow,
          estimatedHigh: insight.contentGaps[0].estimatedHigh,
        }
      : insight.productConfusion.length > 0
        ? {
            productTitle: insight.productConfusion[0].productTitle,
            confusionScore: insight.productConfusion[0].confusionScore,
            mentionCount: insight.productConfusion[0].mentionCount,
          }
        : null;

    // Revenue debug: shows per-finding raw/deduped data with confidence weights
    const showRevenueDebug = debugMode === "revenue" && process.env.NODE_ENV !== "production";
    const revenueDebug = showRevenueDebug ? (() => {
      const rawFindings = insight.contentGaps.map((gap) => ({
        productTitle: gap.productTitle,
        mentionCount: gap.mentionCount,
        missingSections: gap.missingSections,
        estimatedLow: gap.estimatedLow,
        estimatedHigh: gap.estimatedHigh,
        isDirectMention: gap.mentionCount > 0,
        confidenceWeight: gap.mentionCount > 0 ? 1.0 : 0.15,
      }));
      const topicRevenue = new Map<string, { low: number; high: number; count: number }>();
      for (const op of insight.questionOpportunities) {
        topicRevenue.set(op.groupId, { low: op.lowEstimate, high: op.highEstimate, count: op.count });
      }
      return {
        totalImportedMessages: importedMessageCount,
        rawFindingsCount: rawFindings.length,
        directMentionCount: rawFindings.filter((f) => f.isDirectMention).length,
        gapOnlyCount: rawFindings.filter((f) => !f.isDirectMention).length,
        storewideRevenueLow: insight.revenueOpportunity.estimatedLow,
        storewideRevenueHigh: insight.revenueOpportunity.estimatedHigh,
        topTopics: [...topicRevenue.entries()].slice(0, 5).map(([id, v]) => ({ id, ...v })),
        sampleFindings: rawFindings.slice(0, 3),
      };
    })() : null;

    const analysisDebug = showAnalysisDebug || showFindingsDebug ? {
      shopifyProductCount,
      productFindingCount,
      insightRunCount,
      importedMessageCount,
      keywordFindingCount,
      contentGapCount: insight.contentGaps.length,
      productConfusionCount: insight.productConfusion.length,
      lastAnalysisTimestamp: latestRun?.finishedAt?.toISOString() ?? latestRun?.createdAt?.toISOString() ?? null,
      latestGeneratedFinding,
      latestPersistedFindingCount: productFindingCount,
      diagnosis: productFindingCount === 0 && insight.contentGaps.length > 0
        ? "contentGaps present in snapshot but ProductFinding DB rows are 0 — re-run analysis to persist them"
        : productFindingCount === 0 && insight.contentGaps.length === 0
          ? "no contentGaps in snapshot — check if products were synced before analysis ran"
          : "ok",
    } : null;

    console.info("Products route counts", {
      shop: session.shop,
      shopifyProductCount,
      productFindingCount,
      insightRunCount,
      importedMessageCount,
      contentGapCount: insight.contentGaps.length,
    });
    return json({
      insight,
      shopifyProductCount,
      productFindingCount,
      insightRunCount,
      importedMessageCount,
      lastAnalysisTimestamp: latestRun?.finishedAt?.toISOString() ?? latestRun?.createdAt?.toISOString() ?? null,
      analysisDebug,
      revenueDebug,
      loadError: null,
    });
  } catch (error) {
    console.error("Products loader failed", error);
    return json({
      insight: EMPTY_INSIGHT,
      shopifyProductCount: 0,
      productFindingCount: 0,
      insightRunCount: 0,
      importedMessageCount: 0,
      lastAnalysisTimestamp: null,
      analysisDebug: null,
      revenueDebug: null,
      loadError: "Some data could not be loaded. Your store data is safe. Try refreshing or run analysis again.",
    });
  }
}

export default function Products() {
  const {
    insight,
    shopifyProductCount,
    productFindingCount,
    insightRunCount,
    importedMessageCount,
    analysisDebug,
    revenueDebug,
  } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  if (navigation.state === "loading") return <ListSkeleton />;

  const products = [...insight.productConfusion].sort(
    (a, b) => b.confusionScore - a.confusionScore,
  );
  const pageState = getProductsPageState({
    shopifyProductCount,
    productFindingCount,
    insightRunCount,
    products,
    contentGaps: insight.contentGaps,
  });

  // Per-product revenue range (used in individual product cards only).
  const rangeByGroup = new Map<string, { low: number; high: number }>();
  for (const q of insight.questionOpportunities) {
    rangeByGroup.set(q.groupId, { low: q.lowEstimate, high: q.highEstimate });
  }
  const recoveryRangeFor = (topGroups: string[]) =>
    topGroups.reduce(
      (sum, group) => {
        const range = rangeByGroup.get(group);
        return {
          low: sum.low + (range?.low ?? 0),
          high: sum.high + (range?.high ?? 0),
        };
      },
      { low: 0, high: 0 },
    );
  const gapByProduct = new Map(
    insight.contentGaps.map((gap) => [gap.productId ?? gap.productTitle, gap]),
  );

  // Storewide revenue total — consistent with Dashboard and Reports.
  // We do NOT multiply per-product because every product shares the same
  // storewide topics; summing them inflates the total by the product count.
  const storewideRevenueLow = insight.revenueOpportunity.estimatedLow;
  const storewideRevenueHigh = insight.revenueOpportunity.estimatedHigh;

  return (
    <AppPage
      title="Product Recovery Center"
      subtitle="Prioritize products with lost sales risk, content gaps, and competitor pressure."
      primaryAction={<Button url="/app/faq" variant="primary">Generate Content</Button>}
      secondaryAction={<Button url="/app/import">Sync product and order data</Button>}
    >
      <BlockStack gap="400">
        {analysisDebug ? (
          <div className="cia-section-band">
            <BlockStack gap="150">
              <SectionHeader title="Debug: Product Recovery Diagnostics" description="Development-only. Accessible via ?debug=findings" />
              <Text as="p" variant="bodySm"><strong>ShopifyProduct (DB):</strong> {analysisDebug.shopifyProductCount}</Text>
              <Text as="p" variant="bodySm"><strong>ImportedMessage (DB):</strong> {analysisDebug.importedMessageCount}</Text>
              <Text as="p" variant="bodySm"><strong>InsightRun (DB):</strong> {analysisDebug.insightRunCount}</Text>
              <Text as="p" variant="bodySm"><strong>KeywordFinding (DB):</strong> {analysisDebug.keywordFindingCount}</Text>
              <Text as="p" variant="bodySm"><strong>ProductFinding (DB persisted):</strong> {analysisDebug.productFindingCount}</Text>
              <Text as="p" variant="bodySm"><strong>productConfusion (snapshot):</strong> {analysisDebug.productConfusionCount}</Text>
              <Text as="p" variant="bodySm"><strong>contentGaps (snapshot):</strong> {analysisDebug.contentGapCount}</Text>
              <Text as="p" variant="bodySm"><strong>Last analysis:</strong> {analysisDebug.lastAnalysisTimestamp ?? "none"}</Text>
              <Text as="p" variant="bodySm"><strong>Diagnosis:</strong> {analysisDebug.diagnosis}</Text>
              {analysisDebug.latestGeneratedFinding ? (
                <Text as="p" variant="bodySm">
                  <strong>Latest generated finding:</strong> {JSON.stringify(analysisDebug.latestGeneratedFinding)}
                </Text>
              ) : (
                <Text as="p" variant="bodySm" tone="critical"><strong>No generated findings</strong> — products may not have been synced before analysis ran.</Text>
              )}
            </BlockStack>
          </div>
        ) : null}

        {revenueDebug ? (
          <div className="cia-section-band">
            <BlockStack gap="150">
              <SectionHeader title="Debug: Revenue Calculation" description="Development-only. Accessible via ?debug=revenue" />
              <Text as="p" variant="bodySm"><strong>Imported messages total:</strong> {revenueDebug.totalImportedMessages}</Text>
              <Text as="p" variant="bodySm"><strong>Raw content-gap findings:</strong> {revenueDebug.rawFindingsCount}</Text>
              <Text as="p" variant="bodySm"><strong>Direct product mentions:</strong> {revenueDebug.directMentionCount} (weight 1.0)</Text>
              <Text as="p" variant="bodySm"><strong>Gap-only products:</strong> {revenueDebug.gapOnlyCount} (weight 0.15)</Text>
              <Text as="p" variant="bodySm"><strong>Storewide revenue low:</strong> ${revenueDebug.storewideRevenueLow}/mo</Text>
              <Text as="p" variant="bodySm"><strong>Storewide revenue high:</strong> ${revenueDebug.storewideRevenueHigh}/mo</Text>
              <Text as="p" variant="bodySm"><strong>Top topics:</strong> {JSON.stringify(revenueDebug.topTopics)}</Text>
              {revenueDebug.sampleFindings.length > 0 ? (
                <Text as="p" variant="bodySm"><strong>Sample findings:</strong> {JSON.stringify(revenueDebug.sampleFindings)}</Text>
              ) : null}
            </BlockStack>
          </div>
        ) : null}

        {pageState === "needs_sync" ? (
          <EmptyStateCard
            title="Sync products to build your recovery center"
            body="Analyze customer questions to identify products losing buyer confidence and the content needed to recover sales."
            actionLabel="Open data hub"
            actionUrl="/app/import"
          />
        ) : pageState === "needs_analysis" ? (
          <EmptyStateCard
            title="Products synced successfully"
            body="Run analysis to generate recovery opportunities."
            actionLabel="Run analysis"
            actionUrl="/app/import"
          />
        ) : pageState === "no_findings" ? (
          <EmptyStateCard
            title="Products synced. No product-specific recovery gaps detected yet."
            body="Storewide issues (shipping, payment, returns) are available in Insights. Import product-specific customer questions to surface per-product recovery opportunities."
            actionLabel="View storewide insights"
            actionUrl="/app/insights"
          />
        ) : (
          <>
            {(() => {
              // Prefer direct-confusion products when available; fall back to
              // contentGaps (which covers synced products with product-specific
              // content gaps). Gap-only products have mentionCount = 0.
              const displayProducts = products.length > 0
                ? products
                : insight.contentGaps.map((gap) => ({
                    productId: gap.productId,
                    productTitle: gap.productTitle,
                    // Use real mention count (0 for gap-only, real count for direct confusion)
                    mentionCount: gap.mentionCount,
                    confusionScore: gap.contentGapScore,
                    topGroups: gap.missingSections.slice(0, 4),
                    // customerQuestions now contains real question text, not section labels
                    exampleQuote: gap.customerQuestions[0],
                  }));
              // Total direct mentions across products (not inflated by storewide topics)
              const displayMentions = displayProducts.reduce((sum, p) => sum + p.mentionCount, 0);
              return (
                <>
                  <div className="cia-three-grid">
                    <KpiCard
                      label="Products with content gaps"
                      value={formatNumber(displayProducts.length)}
                      detail="Products missing pre-purchase answers"
                      tone="info"
                    />
                    <KpiCard
                      label="Direct product mentions"
                      value={displayMentions > 0 ? formatNumber(displayMentions) : `${formatNumber(importedMessageCount)} storewide`}
                      detail={displayMentions > 0 ? "Questions naming specific products" : "Questions not tied to specific products"}
                      tone={displayMentions > 0 ? "warning" : "subdued"}
                    />
                    <KpiCard
                      label="Recovery potential"
                      value={storewideRevenueHigh > 0 ? `${money(storewideRevenueLow)}-${money(storewideRevenueHigh)}/mo` : "Connect orders"}
                      detail="Storewide estimate — consistent with Dashboard"
                      tone={storewideRevenueHigh > 0 ? "success" : "info"}
                    />
                  </div>

                  <SectionHeader
                    title="Recovery Priority List"
                    description="Each product shows recovery score, questions, content gaps, competitor pressure, potential, and actions."
                    trailing={<Badge tone="info">{`${formatNumber(displayProducts.length)} products`}</Badge>}
                  />

                  <div className="cia-two-grid">
                    {displayProducts.map((product) => {
                      const detailUrl = `/app/products/${encodeURIComponent(
                        product.productId ?? product.productTitle,
                      )}`;
                      const topGroup = product.topGroups[0];
                      const gap = gapByProduct.get(product.productId ?? product.productTitle);
                      const range = recoveryRangeFor(product.topGroups);
                      const completeness = gap ? Math.max(0, 100 - gap.contentGapScore) : undefined;
                      const competitorPressure = product.topGroups.some((group) => group === "competitor" || group === "compare")
                        ? Math.min(100, product.mentionCount * 12)
                        : 0;
                      return (
                        <ProductRecoveryCard
                          key={product.productId ?? product.productTitle}
                          title={product.productTitle}
                          detailUrl={detailUrl}
                          customersAffected={product.mentionCount}
                          topIssue={topGroup}
                          low={range.low}
                          high={range.high}
                          missingContent={gap?.missingSections ?? []}
                          exampleQuestion={product.exampleQuote}
                          score={product.confusionScore}
                          contentCompleteness={completeness}
                          competitorPressure={competitorPressure}
                        />
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </>
        )}
      </BlockStack>
    </AppPage>
  );
}
