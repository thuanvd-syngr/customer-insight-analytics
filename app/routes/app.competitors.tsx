import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Badge, BlockStack, Button, InlineStack, Text } from "@shopify/polaris";
import { useLoaderData, useNavigation } from "@remix-run/react";

import prisma from "~/db.server";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { EMPTY_INSIGHT } from "~/lib/types";
import { authenticate } from "~/shopify.server";
import {
  AppPage,
  BarChart,
  ChartCard,
  CompetitorCard,
  EmptyStateCard,
  KpiCard,
  ListSkeleton,
  PriorityBadge,
  SectionHeader,
  TrendChart,
  type BarDatum,
  formatNumber,
} from "~/components";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  const insight = parseRun(await getLatestRun(prisma, shop.id)) ?? EMPTY_INSIGHT;
  const comparedProducts = insight.productConfusion.filter((product) =>
    product.topGroups.some((group) => group === "competitor" || group === "compare"),
  );
  return json({
    competitors: insight.competitors,
    competitorThreats: insight.competitorThreats,
    comparedProducts,
    trend: insight.weeklyTrend,
  });
}

export default function Competitors() {
  const { competitors, competitorThreats, comparedProducts, trend } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  if (navigation.state === "loading") return <ListSkeleton />;

  // Presentational derivations from real loader data only.
  const totalMentions = competitors.reduce((sum, item) => sum + item.count, 0);
  const topMentions = competitors.reduce((max, item) => Math.max(max, item.count), 0);

  // Competitive-pressure score: weights raw mention volume and breadth of
  // competitors + products being compared, clamped to 0..100.
  const pressureScore = Math.min(
    100,
    Math.round(totalMentions * 6 + competitors.length * 8 + comparedProducts.length * 6),
  );

  // 7-day mention trend: last 7 days vs the prior 7 days of the real timeline.
  const window7 = trend.slice(-7).reduce((sum, p) => sum + p.count, 0);
  const prior7 = trend.slice(-14, -7).reduce((sum, p) => sum + p.count, 0);
  const trend7 = prior7 > 0 ? (window7 - prior7) / prior7 : window7 > 0 ? 1 : 0;

  const sortedCompetitors = [...competitors].sort((a, b) => b.count - a.count);

  const competitorBars: BarDatum[] = sortedCompetitors.map((item) => ({
    label: item.name,
    value: item.count,
    tone: item.count >= 3 ? "critical" : item.count >= 2 ? "warning" : "info",
  }));

  const productBars: BarDatum[] = [...comparedProducts]
    .sort((a, b) => b.mentionCount - a.mentionCount)
    .map((product) => ({
      label: product.productTitle,
      value: product.mentionCount,
      tone: product.confusionScore >= 50 ? "critical" : "warning",
    }));

  const isEmpty = competitors.length === 0 && comparedProducts.length === 0;

  if (isEmpty) {
    return (
      <AppPage
        title="Competitive Intelligence"
        subtitle="See where customers compare you before they buy."
        primaryAction={<Button url="/app/import" variant="primary">Add customer questions</Button>}
        secondaryAction={<Button url="/app/settings">Configure tracking</Button>}
      >
        <EmptyStateCard
          title="Competitor insights will appear here"
          body="We surface competitor mentions and product comparisons from customer messages so you can respond before shoppers leave."
          actionLabel="Open data hub"
          actionUrl="/app/import"
        />
      </AppPage>
    );
  }

  return (
    <AppPage
      title="Competitive Intelligence"
      subtitle="See where customers compare you before they buy."
      primaryAction={<Button url="/app/faq" variant="primary">Create comparison FAQ</Button>}
      secondaryAction={<Button url="/app/settings">Configure tracking</Button>}
    >
      <BlockStack gap="500">
        <div className="cia-three-grid">
          <KpiCard
            label="Competitive threat"
            value={`${pressureScore}/100`}
            detail="Mention volume and affected products"
            tone={pressureScore >= 50 ? "warning" : "info"}
          />
          <KpiCard
            label="Competitors mentioned"
            value={formatNumber(totalMentions)}
            detail={`${formatNumber(competitors.length)} rivals detected`}
            tone="info"
          />
          <KpiCard
            label="Products affected"
            value={formatNumber(comparedProducts.length)}
            detail="Products weighed against alternatives"
            tone={comparedProducts.length > 0 ? "warning" : "info"}
          />
        </div>

        <div className="cia-two-grid">
          <ChartCard title="Mention trend" subtitle="Daily competitor mentions across the analysis window">
            <TrendChart points={trend} tone={pressureScore >= 50 ? "warning" : "info"} height={72} />
          </ChartCard>
          <ChartCard title="Competitors mentioned" subtitle="Where comparison pressure is strongest">
            <BarChart data={competitorBars} tone="info" limit={10} />
          </ChartCard>
        </div>

        {productBars.length > 0 ? (
          <ChartCard title="Products affected" subtitle="Where comparison shopping is hitting hardest">
            <BarChart data={productBars} tone="warning" limit={8} />
          </ChartCard>
        ) : null}

        <BlockStack gap="300">
          <SectionHeader
            title="Recommended counter-actions"
            description="Each competitor includes why customers compare and what to publish next."
          />
          <div className="cia-two-grid">
            {sortedCompetitors.map((item) => {
              const threat = competitorThreats.find((entry) => entry.name === item.name);
              const affectedProducts = comparedProducts
                .filter((product) => product.exampleQuote?.toLowerCase().includes(item.name.toLowerCase()))
                .map((product) => product.productTitle);
              return (
                <CompetitorCard
                  key={item.name}
                  name={item.name}
                  mentions={item.count}
                  reasons={threat?.reasons ?? ["Comparison shopping"]}
                  quote={item.exampleQuote}
                  recommendation={
                    threat?.recommendation ??
                    "Add comparison copy that explains why shoppers should choose this store."
                  }
                  affectedProducts={affectedProducts}
                />
              );
            })}
          </div>
        </BlockStack>

        {comparedProducts.length > 0 ? (
          <ChartCard title="Compared against alternatives" subtitle="Products customers explicitly stack up against rivals">
            <BlockStack gap="300">
              {[...comparedProducts]
                .sort((a, b) => b.mentionCount - a.mentionCount)
                .map((product) => (
                  <InlineStack
                    key={product.productId ?? product.productTitle}
                    align="space-between"
                    blockAlign="center"
                    wrap={false}
                  >
                    <BlockStack gap="050">
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {product.productTitle}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {`${formatNumber(product.mentionCount)} mentions`}
                      </Text>
                    </BlockStack>
                    <PriorityBadge
                      level={product.confusionScore >= 50 ? "high" : product.confusionScore >= 25 ? "medium" : "low"}
                      withLabel
                    />
                  </InlineStack>
                ))}
            </BlockStack>
          </ChartCard>
        ) : null}
      </BlockStack>
    </AppPage>
  );
}
