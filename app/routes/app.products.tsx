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
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { EMPTY_INSIGHT } from "~/lib/types";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  return json({ insight: parseRun(await getLatestRun(prisma, shop.id)) ?? EMPTY_INSIGHT });
}

export default function Products() {
  const { insight } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  if (navigation.state === "loading") return <ListSkeleton />;

  const products = [...insight.productConfusion].sort(
    (a, b) => b.confusionScore - a.confusionScore,
  );
  const totalMentions = products.reduce((sum, p) => sum + p.mentionCount, 0);

  // Real per-product revenue at risk: sum the estimated monthly revenue impact
  // of the friction topics this product is associated with (same model that
  // powers the dashboard's revenue figures — no invented numbers).
  const revenueByGroup = new Map<string, number>();
  const rangeByGroup = new Map<string, { low: number; high: number }>();
  for (const q of insight.questionOpportunities) {
    revenueByGroup.set(q.groupId, q.revenueImpact);
    rangeByGroup.set(q.groupId, { low: q.lowEstimate, high: q.highEstimate });
  }
  const lostRevenueFor = (topGroups: string[]) =>
    topGroups.reduce((sum, g) => sum + (revenueByGroup.get(g) ?? 0), 0);
  const totalLostRevenue = products.reduce(
    (sum, p) => sum + lostRevenueFor(p.topGroups),
    0,
  );
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

  return (
    <AppPage
      title="Products losing confidence"
      subtitle="Find products where customers hesitate before buying."
      primaryAction={<Button url="/app/faq" variant="primary">Generate content</Button>}
      secondaryAction={<Button url="/app/import">Sync Shopify data</Button>}
    >
      <BlockStack gap="400">
        {products.length === 0 ? (
          <EmptyStateCard
            title="Product recovery insights will appear here"
            body="Sync Shopify data and run analysis to see which products create hesitation before purchase."
            actionLabel="Open data hub"
            actionUrl="/app/import"
          />
        ) : (
          <>
            <div className="cia-three-grid">
              <KpiCard
                label="Products at risk"
                value={formatNumber(products.length)}
                detail="Products with purchase hesitation"
                tone="info"
              />
              <KpiCard
                label="Customers affected"
                value={formatNumber(totalMentions)}
                detail="Questions tied to products"
                tone="warning"
              />
              <KpiCard
                label="Recovery estimate"
                value={totalLostRevenue > 0 ? `${money(totalLostRevenue)}/mo` : "Recovery estimate pending"}
                detail="Based on related friction topics"
                tone={totalLostRevenue > 0 ? "success" : "info"}
              />
            </div>

            <SectionHeader
              title="Product Recovery Center"
              description="Prioritize fixes for products that are losing buyer confidence."
              trailing={<Badge tone="info">{`${formatNumber(products.length)} products`}</Badge>}
            />

            <div className="cia-two-grid">
              {products.map((product) => {
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
        )}
      </BlockStack>
    </AppPage>
  );
}
