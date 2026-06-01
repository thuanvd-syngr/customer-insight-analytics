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
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { EMPTY_INSIGHT } from "~/lib/types";
import type { LeakageSeverity } from "~/lib/types";
import { authenticate } from "~/shopify.server";
import { safeCount } from "~/lib/prisma-safe";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shop = await ensureShop(prisma, session.shop);
    const [productCount, importedMessageCount] = await Promise.all([
      safeCount(prisma, "shopifyProduct", { where: { shopId: shop.id } }),
      safeCount(prisma, "importedMessage", { where: { shopId: shop.id } }),
    ]);
    return json({
      insight: parseRun(await getLatestRun(prisma, shop.id)) ?? EMPTY_INSIGHT,
      productCount,
      importedMessageCount,
      loadError: null,
    });
  } catch (error) {
    console.error("Insights loader failed", error);
    return json({
      insight: EMPTY_INSIGHT,
      productCount: 0,
      importedMessageCount: 0,
      loadError: "Some data could not be loaded. Your store data is safe. Try refreshing or run analysis again.",
    });
  }
}

export default function Insights() {
  const { insight, productCount, importedMessageCount } = useLoaderData<typeof loader>();
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
        title="Revenue Opportunities"
        subtitle="Prioritized issues that cost revenue and the fix to create next."
        primaryAction={<Button url="/app/import" variant="primary">Add customer questions</Button>}
      >
        {importedMessageCount > 0 && productCount === 0 ? (
          <Banner tone="info" title="Product mapping requires product sync">
            <p>Customer questions can still be analyzed, but product-level mapping needs product sync.</p>
          </Banner>
        ) : null}
        <EmptyStateCard
          title="Import conversations to discover revenue opportunities"
          body="Analyze customer questions to identify lost sales, affected customers, and the first fix to create."
          actionLabel="Open data hub"
          actionUrl="/app/import"
        />
      </AppPage>
    );
  }

  return (
    <AppPage
      title="Revenue Opportunities"
      subtitle="Highest-value buying objections ranked by revenue impact."
      primaryAction={<Button url="/app/faq" variant="primary">Create Revenue Recovery Content</Button>}
      secondaryAction={<Button url="/app/products">View products</Button>}
    >
      {importedMessageCount > 0 && productCount === 0 ? (
        <Banner tone="info" title="Product mapping requires product sync">
          <p>Insights are based on imported customer questions. Sync product data to map issues to specific products.</p>
        </Banner>
      ) : null}
      <BlockStack gap="500">
        <div className="cia-four-grid">
          <KpiCard
            label="Customers impacted"
            value={formatNumber(totalQuestions)}
            detail={`${opportunities.length} revenue issues`}
            tone="info"
          />
          <KpiCard
            label="High priority topics"
            value={formatNumber(highImpact)}
            detail="Requires merchant action"
            tone={highImpact > 0 ? "warning" : "info"}
          />
          <KpiCard
            label="Recovery impact"
            value={recoverableHigh > 0 ? formatMoneyRange(recoverableLow, recoverableHigh) : "Connect orders"}
            detail="Estimated monthly upside if answered"
            tone="success"
          />
          <KpiCard
            label="Fastest rising topic"
            value={worstTrend > 0 ? `+${Math.round(worstTrend * 100)}%` : "Stable"}
            detail="Largest 7-day increase"
            tone={worstTrend > 0 ? "warning" : "info"}
          />
        </div>

        <div className="cia-section-band">
          <BlockStack gap="300">
            <SectionHeader
              title="Revenue Opportunities"
              description="Each issue includes customer impact, trend, recovery estimate, priority, and the next fix."
            />
            {opportunities.slice(0, 4).map((item) => {
              const productsAffected = insight.productConfusion.filter((product) =>
                product.topGroups.includes(item.groupId),
              ).length;
              return (
                <div className="cia-queue-row" key={item.groupId}>
                  <div className="cia-rank">{item.count}</div>
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h3" variant="headingMd">
                        {item.label}
                      </Text>
                      <PriorityBadge level={item.severity} withLabel />
                    </InlineStack>
                    <InlineStack gap="300" blockAlign="center">
                      <Badge tone="info">{`${item.count} mentions`}</Badge>
                      <TrendIndicator value={item.trend7} suffix="growth" />
                      <Badge tone="warning">{`${productsAffected || "Storewide"} products affected`}</Badge>
                    </InlineStack>
                  </BlockStack>
                  <Text as="span" variant="headingMd" tone={item.highEstimate > 0 ? "success" : "subdued"}>
                    {item.highEstimate > 0 ? `${moneyRange(item.lowEstimate, item.highEstimate)}/mo` : "Connect orders"}
                  </Text>
                  <Button url="/app/faq" variant={item.severity === "high" ? "primary" : undefined}>Generate Fix</Button>
                </div>
              );
            })}
          </BlockStack>
        </div>

        <BlockStack gap="300">
          <SectionHeader
            title="Fix Cards"
            description="Create the exact content needed to recover the sale."
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
