import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigation } from "@remix-run/react";
import {
  Banner,
  Badge,
  BlockStack,
  Button,
  InlineStack,
  Text,
} from "@shopify/polaris";

import {
  AppPage,
  EmptyStateCard,
  InsightOpportunityCard,
  KpiCard,
  ListSkeleton,
  SectionHeader,
  TrendIndicator,
  formatMoneyRange,
  formatNumber,
  moneyRange,
  PriorityBadge,
} from "~/components";
import prisma from "~/db.server";
import { productRecoveryPath } from "~/lib/action-loading";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { EMPTY_INSIGHT } from "~/lib/types";
import type { LeakageSeverity } from "~/lib/types";
import { authenticate } from "~/shopify.server";
import { safeCount } from "~/lib/prisma-safe";
import { isReviewerMode, buildSampleInsight } from "~/lib/reviewer-mode.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shop = await ensureShop(prisma, session.shop);
    const [productCount, importedMessageCount] = await Promise.all([
      safeCount(prisma, "shopifyProduct", { where: { shopId: shop.id } }),
      safeCount(prisma, "importedMessage", { where: { shopId: shop.id } }),
    ]);
    const latestRun = await getLatestRun(prisma, shop.id);
    const sampleMode = !latestRun && importedMessageCount === 0
      ? await isReviewerMode(prisma, shop.id)
      : false;
    return json({
      insight: sampleMode ? buildSampleInsight() : (parseRun(latestRun) ?? EMPTY_INSIGHT),
      productCount,
      importedMessageCount,
      isSampleMode: sampleMode,
      loadError: null,
    });
  } catch (error) {
    console.error("Insights loader failed", error);
    return json({
      insight: EMPTY_INSIGHT,
      productCount: 0,
      importedMessageCount: 0,
      isSampleMode: false,
      loadError: "Data is loading. Refresh in a moment to see your opportunities.",
    });
  }
}

export default function Insights() {
  const { insight, productCount, importedMessageCount, isSampleMode } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  if (navigation.state === "loading") return <ListSkeleton rows={6} />;

  // Use the prioritized question opportunities; fall back to raw friction groups.
  const opportunities =
    insight.questionOpportunities.length > 0
      ? insight.questionOpportunities
      : insight.keywordGroups.map((group) => ({
          groupId: group.groupId,
          label: group.label,
          count: group.count,
          trend7: group.trend7,
          severity: (group.frictionWeight >= 0.66
            ? "high"
            : group.frictionWeight >= 0.33
              ? "medium"
              : "low") as LeakageSeverity,
          revenueImpact: 0,
          lowEstimate: 0,
          highEstimate: 0,
          priorityScore: Math.min(100, Math.round(group.count * 3 + group.frictionWeight * 30)),
          actionType: "faq" as const,
          suggestedAction: `Prepare an FAQ answer about ${group.label.toLowerCase()}.`,
          exampleQuote: group.exampleQuote,
        }));

  const hasData = opportunities.length > 0;
  const storewideOpportunities = insight.storewideOpportunities;
  const productOpportunities = insight.contentGaps;

  // Hero metrics derived from real loader values.
  const totalQuestions = opportunities.reduce((sum, item) => sum + item.count, 0);
  const recoverableLow = opportunities.reduce((sum, item) => sum + (item.lowEstimate || item.revenueImpact || 0), 0);
  const recoverableHigh = opportunities.reduce((sum, item) => sum + (item.highEstimate || item.revenueImpact || 0), 0);
  const highImpact = opportunities.filter((item) => item.severity === "high").length;
  const worstTrend = opportunities.reduce(
    (max, item) => Math.max(max, item.trend7 || 0),
    0,
  );

  if (!hasData) {
    return (
      <AppPage
        title="Lost Sales Opportunities"
        subtitle="Customer questions blocking purchases — ranked by revenue impact."
        primaryAction={<Button url="/app/import" variant="primary">Import Customer Questions</Button>}
      >
        {importedMessageCount > 0 && productCount === 0 ? (
          <Banner tone="info" title="Product mapping requires product sync">
            <p>Customer questions can still be analyzed, but product-level mapping needs product sync.</p>
          </Banner>
        ) : null}
        <EmptyStateCard
          title="Import customer questions to discover what's costing you sales"
          body="Analyze buying objections to find lost sales, affected customers, and the answers that recover revenue."
          actionLabel="Import Customer Questions"
          actionUrl="/app/import"
        />
      </AppPage>
    );
  }

  return (
    <AppPage
      title="Lost Sales Opportunities"
      subtitle="Customer questions blocking purchases — ranked by revenue impact."
      primaryAction={<Button url="/app/faq" variant="primary">Generate Answers</Button>}
      secondaryAction={<Button url="/app/products">View Products</Button>}
    >
      {isSampleMode ? (
        <Banner tone="info" title="Sample data — showing demo opportunities">
          <p>
            Your store has no customer questions yet. This page shows example opportunities
            so you can explore the recovery workflow. Import real questions to see your actual data.
          </p>
          <Button url="/app/import" variant="plain">Import Customer Questions</Button>
        </Banner>
      ) : null}
      {!isSampleMode && importedMessageCount > 0 && productCount === 0 ? (
        <Banner tone="info" title="Product mapping requires product sync">
          <p>Insights are based on imported customer questions. Sync product data to map issues to specific products.</p>
        </Banner>
      ) : null}
      <BlockStack gap="500">
        <div className="cia-four-grid">
          <KpiCard
            label="Questions Analyzed"
            value={formatNumber(totalQuestions)}
            detail={`${opportunities.length} buying objections found`}
            tone="info"
          />
          <KpiCard
            label="High Priority Issues"
            value={formatNumber(highImpact)}
            detail="Needs your attention now"
            tone={highImpact > 0 ? "warning" : "info"}
          />
          <KpiCard
            label="Revenue You Could Recover"
            value={recoverableHigh > 0 ? formatMoneyRange(recoverableLow, recoverableHigh) : "Connect orders"}
            detail="Estimated monthly upside if answered"
            tone="success"
          />
          <KpiCard
            label="Fastest Growing Issue"
            value={worstTrend > 0 ? `+${Math.round(worstTrend * 100)}%` : "Stable"}
            detail="Largest 7-day increase"
            tone={worstTrend > 0 ? "warning" : "info"}
          />
        </div>

        <div className="cia-section-band">
          <BlockStack gap="300">
            <SectionHeader
              title="Questions Blocking Sales"
              description="Shipping, payment, returns, and delivery questions that stop buyers across your entire store."
            />
            {(storewideOpportunities.length > 0 ? storewideOpportunities : opportunities.filter((item) =>
              ["shipping", "delivery", "payment", "return", "refund", "discount"].includes(item.groupId),
            )).slice(0, 6).map((item) => {
              return (
                <div className="cia-queue-row" key={item.groupId}>
                  <div className="cia-rank">{"mentionCount" in item ? item.mentionCount : item.count}</div>
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h3" variant="headingMd">
                        {item.label}
                      </Text>
                      <PriorityBadge level={item.severity} withLabel />
                    </InlineStack>
                    <InlineStack gap="300" blockAlign="center">
                      <Badge tone="info">{`${"mentionCount" in item ? item.mentionCount : item.count} mentions`}</Badge>
                      <TrendIndicator value={"trend7" in item ? item.trend7 : 0} suffix="growth" />
                      <Badge tone="warning">Storewide</Badge>
                    </InlineStack>
                  </BlockStack>
                  <Text as="span" variant="headingMd" tone={item.highEstimate > 0 ? "success" : "subdued"}>
                    {item.highEstimate > 0 ? `${moneyRange(item.lowEstimate, item.highEstimate)}/mo` : "Connect orders"}
                  </Text>
                  <Button url="/app/faq" variant={item.severity === "high" ? "primary" : undefined}>Create Answer</Button>
                </div>
              );
            })}
          </BlockStack>
        </div>

        <div className="cia-section-band">
          <BlockStack gap="300">
            <SectionHeader
              title="Products Losing Sales"
              description="Products where customer questions reveal missing answers. Questions must mention a product name or keyword to appear here."
            />
            {productOpportunities.length > 0 ? (
              productOpportunities.slice(0, 6).map((gap) => (
                <div className="cia-queue-row" key={gap.productId ?? gap.productTitle}>
                  <div className="cia-rank">{gap.mentionCount}</div>
                  <BlockStack gap="100">
                    <Text as="h3" variant="headingMd">{gap.productTitle}</Text>
                    <InlineStack gap="300" blockAlign="center">
                      <Badge tone="info">{`${gap.mentionCount} matched questions`}</Badge>
                      <Badge tone="warning">{gap.missingSections[0] ?? "Recovery gap"}</Badge>
                    </InlineStack>
                  </BlockStack>
                  <Text as="span" variant="headingMd" tone={gap.estimatedHigh > 0 ? "success" : "subdued"}>
                    {gap.estimatedHigh > 0 ? `${moneyRange(gap.estimatedLow, gap.estimatedHigh)}/mo` : "Qualitative"}
                  </Text>
                  <Button url={productRecoveryPath(gap.productId ?? gap.productTitle)}>Open</Button>
                </div>
              ))
            ) : (
              <Banner tone="info" title="No product-specific questions found yet">
                <p>Questions Blocking Sales above can be answered first. Product-specific issues appear once customer questions mention your product names.</p>
              </Banner>
            )}
          </BlockStack>
        </div>

        <BlockStack gap="300">
          <SectionHeader
            title="Recovery Actions"
            description="Generate the right answer for each buying objection and recover the sale."
          />
          <div className="cia-two-grid">
            {opportunities.map((item) => (
              <InsightOpportunityCard
                key={item.groupId}
                groupId={item.groupId}
                topic={item.label}
                priority={item.severity}
                customersAffected={item.count}
                trend={item.trend7}
                low={item.lowEstimate}
                high={item.highEstimate}
                quote={item.exampleQuote}
                action={item.suggestedAction}
              />
            ))}
          </div>
        </BlockStack>
      </BlockStack>
    </AppPage>
  );
}
