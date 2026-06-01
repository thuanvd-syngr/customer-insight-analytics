import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Badge, Banner, BlockStack, Button, InlineStack, Text } from "@shopify/polaris";
import { useLoaderData, useNavigation } from "@remix-run/react";

import prisma from "~/db.server";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { EMPTY_INSIGHT } from "~/lib/types";
import type { CompetitorMentionResult, CompetitorThreat, ProductConfusionResult, TrendPoint } from "~/lib/types";
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
  try {
    const { session } = await authenticate.admin(request);
    const shop = await ensureShop(prisma, session.shop);
    const url = new URL(request.url);
    const debugMode = process.env.NODE_ENV !== "production" ? url.searchParams.get("debug") : null;
    const insight = parseRun(await getLatestRun(prisma, shop.id)) ?? EMPTY_INSIGHT;

    // Only include products as "affected by competitors" when a customer message
    // BOTH named a competitor brand AND mentioned a specific product. Generic
    // "compare" language ("vs", "which is better") without a real competitor
    // brand mention does NOT create competitor-affected products.
    const hasCompetitorMentions = insight.competitors.length > 0;
    const comparedProducts = hasCompetitorMentions
      ? insight.productConfusion.filter((product) =>
          product.topGroups.some((group) => group === "competitor" || group === "compare"),
        )
      : [];

    // Comparison-signal products: products with compare/competitor topics but
    // no real brand mentions. Used only for the informational banner.
    const comparisonSignalProducts = !hasCompetitorMentions
      ? insight.productConfusion.filter((product) =>
          product.topGroups.some((group) => group === "competitor" || group === "compare"),
        )
      : [];

    // Competitor debug info (dev only)
    const competitorsDebug = debugMode === "competitors"
      ? {
          detectedBrandMentions: insight.competitors.map((c) => ({ name: c.name, count: c.count })),
          affectedProducts: comparedProducts.map((p) => ({ title: p.productTitle, score: p.confusionScore })),
          comparisonSignalProducts: comparisonSignalProducts.map((p) => ({ title: p.productTitle })),
          totalMentions: insight.competitors.reduce((sum, c) => sum + c.count, 0),
          threatScoreFormula: "totalMentions * 6 + competitors.length * 8 + comparedProducts.length * 6 (capped at 100, 0 when no brand mentions)",
          note: "Configure competitor brand names in Settings to detect specific rivals.",
        }
      : null;

    return json({
      competitors: insight.competitors,
      competitorThreats: insight.competitorThreats,
      comparedProducts,
      comparisonSignalProducts,
      trend: insight.weeklyTrend,
      competitorsDebug,
      loadError: null,
    });
  } catch (error) {
    console.error("Competitors loader failed", error);
    return json({
      competitors: [],
      competitorThreats: [],
      comparedProducts: [],
      comparisonSignalProducts: [],
      trend: [],
      competitorsDebug: null,
      loadError: "Some data could not be loaded. Your store data is safe. Try refreshing or run analysis again.",
    });
  }
}

export default function Competitors() {
  const data = useLoaderData<typeof loader>();
  const competitors = data.competitors as CompetitorMentionResult[];
  const competitorThreats = data.competitorThreats as CompetitorThreat[];
  const comparedProducts = data.comparedProducts as ProductConfusionResult[];
  const comparisonSignalProducts = (data.comparisonSignalProducts ?? []) as ProductConfusionResult[];
  const trend = data.trend as TrendPoint[];
  const competitorsDebug = data.competitorsDebug;
  const navigation = useNavigation();
  if (navigation.state === "loading") return <ListSkeleton />;

  // Empty when no competitor brands detected in any message.
  // Generic comparison language ("vs", "compare") without a brand name does
  // not qualify as a competitor threat.
  const isEmpty = competitors.length === 0;

  if (isEmpty) {
    return (
      <AppPage
        title="Competitive Revenue Threats"
        subtitle="Find competitors costing buyer confidence and create response content."
        primaryAction={<Button url="/app/import" variant="primary">Add customer questions</Button>}
        secondaryAction={<Button url="/app/settings">Configure tracking</Button>}
      >
        {competitorsDebug ? (
          <div className="cia-section-band">
            <BlockStack gap="150">
              <SectionHeader title="Debug: Competitor Detection" description="Development-only. Accessible via ?debug=competitors" />
              <Text as="p" variant="bodySm"><strong>Brand mentions detected:</strong> {competitorsDebug.detectedBrandMentions.length}</Text>
              <Text as="p" variant="bodySm"><strong>Comparison-signal products (generic, no brand):</strong> {competitorsDebug.comparisonSignalProducts.length}</Text>
              <Text as="p" variant="bodySm"><strong>Threat score formula:</strong> {competitorsDebug.threatScoreFormula}</Text>
              <Text as="p" variant="bodySm"><strong>Note:</strong> {competitorsDebug.note}</Text>
            </BlockStack>
          </div>
        ) : null}
        {comparisonSignalProducts.length > 0 ? (
          <Banner tone="info" title="Comparison questions detected">
            <p>{`${comparisonSignalProducts.length} product(s) have comparison questions but no competitor brand names were identified. Add competitor terms in Settings to track specific rivals.`}</p>
          </Banner>
        ) : null}
        <EmptyStateCard
          title="No competitor mentions detected"
          body="Competitor brand names were not found in the analyzed customer questions. Configure competitor terms in Settings or import conversations that mention specific rivals."
          actionLabel="Configure competitor tracking"
          actionUrl="/app/settings"
        />
      </AppPage>
    );
  }

  // Presentational derivations — only when real competitor brand mentions exist.
  const totalMentions = competitors.reduce((sum, item) => sum + item.count, 0);

  // Competitive-pressure score: meaningful only when there are real brand mentions.
  const pressureScore = totalMentions === 0
    ? 0
    : Math.min(100, Math.round(totalMentions * 6 + competitors.length * 8 + comparedProducts.length * 6));

  // 7-day mention trend from the real analysis timeline.
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

  return (
    <AppPage
      title="Competitive Revenue Threats"
      subtitle="Competitors customers mention before leaving your store."
      primaryAction={<Button url="/app/faq" variant="primary">Generate Comparison FAQ</Button>}
      secondaryAction={<Button url="/app/settings">Configure tracking</Button>}
    >
      <BlockStack gap="500">
        {competitorsDebug ? (
          <div className="cia-section-band">
            <BlockStack gap="150">
              <SectionHeader title="Debug: Competitor Detection" description="Development-only. Accessible via ?debug=competitors" />
              <Text as="p" variant="bodySm"><strong>Brand mentions detected:</strong> {competitorsDebug.detectedBrandMentions.length}</Text>
              <Text as="p" variant="bodySm"><strong>Total brand mentions:</strong> {competitorsDebug.totalMentions}</Text>
              <Text as="p" variant="bodySm"><strong>Affected products (via brand+product signal):</strong> {competitorsDebug.affectedProducts.length}</Text>
              <Text as="p" variant="bodySm"><strong>Comparison-signal (no brand name):</strong> {competitorsDebug.comparisonSignalProducts.length}</Text>
              <Text as="p" variant="bodySm"><strong>Pressure score formula:</strong> {competitorsDebug.threatScoreFormula}</Text>
            </BlockStack>
          </div>
        ) : null}
        <div className="cia-three-grid">
          <KpiCard
            label="Threat score"
            value={`${pressureScore}/100`}
            detail="Mention volume and affected products"
            tone={pressureScore >= 50 ? "warning" : "info"}
          />
          <KpiCard
            label="Customer concerns"
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
          <ChartCard title="Threat trend" subtitle="Daily competitor concerns across the analysis window">
            <TrendChart points={trend} tone={pressureScore >= 50 ? "warning" : "info"} height={72} />
          </ChartCard>
          <ChartCard title="Competitor pressure" subtitle="Where comparison pressure is strongest">
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
            title="Competitive Revenue Threat Cards"
            description="Each competitor includes threat score, affected products, customer concerns, suggested response, recommended content, and FAQ opportunity."
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
