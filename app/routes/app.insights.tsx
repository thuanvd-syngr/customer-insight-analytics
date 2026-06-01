import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigation } from "@remix-run/react";
import {
  Badge,
  BlockStack,
  Button,
  InlineStack,
  Text,
} from "@shopify/polaris";

import {
  AppPage,
  BarChart,
  ChartCard,
  EmptyStateCard,
  InsightOpportunityCard,
  KpiCard,
  ListSkeleton,
  SectionHeader,
  TrendIndicator,
  compactMoney,
  formatNumber,
  moneyRange,
  PriorityBadge,
} from "~/components";
import type { BarDatum } from "~/components";
import prisma from "~/db.server";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { EMPTY_INSIGHT } from "~/lib/types";
import type { LeakageSeverity } from "~/lib/types";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  return json({ insight: parseRun(await getLatestRun(prisma, shop.id)) ?? EMPTY_INSIGHT });
}

const SEVERITY_TONE: Record<LeakageSeverity, "critical" | "warning" | "info"> = {
  high: "critical",
  medium: "warning",
  low: "info",
};

export default function Insights() {
  const { insight } = useLoaderData<typeof loader>();
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

  // Friction-group overview for the BarChart (sorted by demand).
  const frictionBars: BarDatum[] = opportunities
    .slice()
    .sort((a, b) => b.count - a.count)
    .map((item) => ({
      label: item.label,
      value: item.count,
      display: formatNumber(item.count),
      tone: SEVERITY_TONE[item.severity] === "critical"
        ? "critical"
        : SEVERITY_TONE[item.severity] === "warning"
          ? "warning"
          : "info",
    }));

  if (!hasData) {
    return (
      <AppPage
        title="Customer Friction Intelligence"
        subtitle="Find the highest revenue opportunities hidden in repeated customer questions."
        primaryAction={<Button url="/app/import" variant="primary">Add customer questions</Button>}
      >
        <EmptyStateCard
          title="Recovery opportunities will appear here"
          body="Once customer messages are analyzed, the questions that block purchases will appear here ranked by impact and recoverable revenue."
          actionLabel="Open data hub"
          actionUrl="/app/import"
        />
      </AppPage>
    );
  }

  return (
    <AppPage
      title="Customer Friction Intelligence"
      subtitle="Highest-value questions customers ask before buying."
      primaryAction={<Button url="/app/faq" variant="primary">Generate FAQ</Button>}
      secondaryAction={<Button url="/app/products">View products</Button>}
    >
      <BlockStack gap="500">
        <div className="cia-four-grid">
          <KpiCard
            label="Questions analyzed"
            value={formatNumber(totalQuestions)}
            detail={`${opportunities.length} friction topics`}
            tone="info"
          />
          <KpiCard
            label="High priority topics"
            value={formatNumber(highImpact)}
            detail="Requires merchant action"
            tone={highImpact > 0 ? "warning" : "info"}
          />
          <KpiCard
            label="Recoverable revenue"
            value={recoverableHigh > 0 ? `${compactMoney(recoverableLow)}-${compactMoney(recoverableHigh)}` : "Recovery estimate pending"}
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
              title="Highest Revenue Opportunities"
              description="The customer frictions most likely to affect conversion and product confidence."
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
                    {item.highEstimate > 0 ? `${moneyRange(item.lowEstimate, item.highEstimate)}/mo` : "Recovery estimate pending"}
                  </Text>
                </div>
              );
            })}
          </BlockStack>
        </div>

        <ChartCard title="Friction by topic" subtitle="Where customers get stuck before buying, ranked by volume.">
          <BarChart data={frictionBars} tone="info" limit={8} />
        </ChartCard>

        <BlockStack gap="300">
          <SectionHeader
            title="Recommended friction fixes"
            description="Create the content customers need before they leave the product page."
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
