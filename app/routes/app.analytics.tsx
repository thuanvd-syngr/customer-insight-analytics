import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigation } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Divider,
  InlineGrid,
  InlineStack,
  ProgressBar,
  Text,
} from "@shopify/polaris";

import prisma from "~/db.server";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { EMPTY_INSIGHT } from "~/lib/types";
import { authenticate } from "~/shopify.server";
import { AppPage, DashboardSkeleton, SectionHeader, formatNumber, KpiCard, moneyRange } from "~/components";
import { getDelegate, safeCount } from "~/lib/prisma-safe";
import { aggregateByEventType, EVENT_TYPE_LABELS } from "~/lib/revenue-timeline";
import type { RevenueEventType } from "~/lib/revenue-timeline";
import { PLANS } from "~/lib/billing";
import type { PlanId } from "~/lib/billing";

async function getCtx(request: Request) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  return { shop, session };
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { shop } = await getCtx(request);
    const insight = parseRun(await getLatestRun(prisma, shop.id)) ?? EMPTY_INSIGHT;

    // Count published content
    const publishedCount = await safeCount(prisma, "publishedContent", { where: { shopId: shop.id, status: "published" } });
    const faqCount = await prisma.generatedFaq.count({ where: { shopId: shop.id } });
    const publishedFaqCount = await prisma.generatedFaq.count({ where: { shopId: shop.id, status: "published" } });

    // Products with content gaps
    const productsFixed = insight.contentGaps.filter((g) => g.missingSections.length === 0).length;
    const productsNeedingWork = insight.contentGaps.filter((g) => g.missingSections.length > 0).length;

    // Bulk jobs
    const bulkJob = getDelegate(prisma, "bulkJob");
    const completedBulkJobs = bulkJob?.count
      ? await bulkJob.count({ where: { shopId: shop.id, status: "completed" } })
      : 0;

    // Revenue events
    const revenueEvent = getDelegate(prisma, "revenueEvent");
    const revEvents = revenueEvent?.findMany
      ? await revenueEvent.findMany({ where: { shopId: shop.id }, orderBy: { occurredAt: "desc" }, take: 200 })
      : [];
    const typedRevEvents = (revEvents as Array<{
      id: string; eventType: string; description: string;
      lowEstimate: number; highEstimate: number;
      actualValue?: number | null; occurredAt: Date | string;
    }>).map((e) => ({
      id: e.id,
      eventType: e.eventType as RevenueEventType,
      description: e.description,
      lowEstimate: e.lowEstimate,
      highEstimate: e.highEstimate,
      actualValue: e.actualValue ?? null,
      occurredAt: e.occurredAt,
    }));

    const syntheticLow = publishedCount * 50;
    const syntheticHigh = publishedCount * 150;
    const eventLow = typedRevEvents.reduce((s, e) => s + e.lowEstimate, 0);
    const eventHigh = typedRevEvents.reduce((s, e) => s + e.highEstimate, 0);
    const estimatedTotalLow = Math.round(syntheticLow + eventLow);
    const estimatedTotalHigh = Math.round(syntheticHigh + eventHigh);

    // Store health score (composite)
    const storeHealthScore = Math.min(
      100,
      Math.round(
        (insight.insightScore * 0.4) +
        (publishedCount > 0 ? 20 : 0) +
        (faqCount > 5 ? 15 : faqCount * 3) +
        (insight.competitors.length === 0 ? 15 : Math.max(0, 15 - insight.competitors.length * 2)) +
        (insight.storewideOpportunities.filter((o) => o.severity === "high").length === 0 ? 10 : 0),
      ),
    );

    const plan = shop.plan as PlanId;
    const canAnalytics = PLANS[plan]?.features.weeklyReports ?? false;

    return json({
      insight,
      publishedCount,
      faqCount,
      publishedFaqCount,
      productsFixed,
      productsNeedingWork,
      completedBulkJobs,
      estimatedTotalLow,
      estimatedTotalHigh,
      storeHealthScore,
      eventTypeBreakdown: aggregateByEventType(typedRevEvents),
      canAnalytics,
      loadError: null,
    });
  } catch (error) {
    console.error("Analytics V2 loader failed", error);
    return json({
      insight: EMPTY_INSIGHT,
      publishedCount: 0,
      faqCount: 0,
      publishedFaqCount: 0,
      productsFixed: 0,
      productsNeedingWork: 0,
      completedBulkJobs: 0,
      estimatedTotalLow: 0,
      estimatedTotalHigh: 0,
      storeHealthScore: 0,
      eventTypeBreakdown: [],
      canAnalytics: false,
      loadError: "Could not load analytics. Try refreshing.",
    });
  }
}

function healthTone(score: number): "success" | "warning" | "critical" {
  if (score >= 70) return "success";
  if (score >= 40) return "warning";
  return "critical";
}

function healthLabel(score: number): string {
  if (score >= 80) return "Excellent";
  if (score >= 60) return "Good";
  if (score >= 40) return "Needs Attention";
  return "Critical";
}

export default function AnalyticsPage() {
  const {
    insight,
    publishedCount,
    faqCount,
    publishedFaqCount,
    productsFixed,
    productsNeedingWork,
    completedBulkJobs,
    estimatedTotalLow,
    estimatedTotalHigh,
    storeHealthScore,
    eventTypeBreakdown,
    canAnalytics,
    loadError,
  } = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  if (navigation.state === "loading") return <DashboardSkeleton />;

  return (
    <AppPage
      title="Analytics Dashboard V2"
      subtitle="Revenue recovered, content published, products fixed, and overall store health."
      primaryAction={<Button url="/app/roi">Revenue Timeline</Button>}
      secondaryAction={<Button url="/app/insights">View Opportunities</Button>}
    >
      <BlockStack gap="500">
        {loadError ? <Banner tone="critical" title="Load error"><p>{loadError}</p></Banner> : null}

        {!canAnalytics ? (
          <Banner tone="warning" title="Growth plan required for full analytics">
            <p>Detailed analytics are available on Growth plan and above. <a href="/app/billing">Upgrade →</a></p>
          </Banner>
        ) : null}

        {/* Hero KPIs */}
        <InlineGrid columns={{ xs: 2, sm: 4 }} gap="400">
          <KpiCard
            label="Revenue Recovered (Est.)"
            value={`$${formatNumber(estimatedTotalLow)}–$${formatNumber(estimatedTotalHigh)}`}
            detail="Based on published content"
          />
          <KpiCard
            label="Content Published"
            value={String(publishedCount)}
            detail={`${publishedFaqCount} FAQs published`}
          />
          <KpiCard
            label="Products Optimized"
            value={String(productsFixed)}
            detail={`${productsNeedingWork} still need attention`}
          />
          <KpiCard
            label="Bulk Jobs Done"
            value={String(completedBulkJobs)}
            detail="Completed batch operations"
          />
        </InlineGrid>

        {/* Store Health */}
        <Card>
          <BlockStack gap="400">
            <SectionHeader
              title="Store Health Score"
              description="A composite of insight score, content coverage, competitor risk, and publishing activity."
            />
            <InlineStack align="space-between" blockAlign="center" wrap={false} gap="400">
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">Health Score</Text>
                  <InlineStack gap="200">
                    <Text as="p" variant="headingLg">{storeHealthScore}/100</Text>
                    <Badge tone={healthTone(storeHealthScore)}>{healthLabel(storeHealthScore)}</Badge>
                  </InlineStack>
                </InlineStack>
                <ProgressBar
                  progress={storeHealthScore}
                  size="large"
                  tone={storeHealthScore >= 70 ? "success" : storeHealthScore >= 40 ? "primary" : "critical"}
                />
              </BlockStack>
            </InlineStack>

            <InlineGrid columns={{ xs: 2, sm: 4 }} gap="300">
              <div className="cia-muted-panel">
                <div className="cia-eyebrow">Insight Score</div>
                <Text as="p" variant="headingMd">{insight.insightScore}/100</Text>
              </div>
              <div className="cia-muted-panel">
                <div className="cia-eyebrow">Messages Analyzed</div>
                <Text as="p" variant="headingMd">{formatNumber(insight.messageCount)}</Text>
              </div>
              <div className="cia-muted-panel">
                <div className="cia-eyebrow">High-Severity Gaps</div>
                <Text as="p" variant="headingMd">
                  {insight.storewideOpportunities.filter((o) => o.severity === "high").length}
                </Text>
              </div>
              <div className="cia-muted-panel">
                <div className="cia-eyebrow">Competitor Threats</div>
                <Text as="p" variant="headingMd">{insight.competitors.length}</Text>
              </div>
            </InlineGrid>
          </BlockStack>
        </Card>

        {/* Content breakdown */}
        <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
          <Card>
            <BlockStack gap="300">
              <SectionHeader title="Content Activity" description="FAQs and pages published over time." />
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">FAQs Generated</Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">{faqCount}</Text>
                </InlineStack>
                <Divider />
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">FAQs Published</Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">{publishedFaqCount}</Text>
                </InlineStack>
                <Divider />
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">Pages Published</Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">{publishedCount}</Text>
                </InlineStack>
                <Divider />
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">Bulk Jobs Completed</Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">{completedBulkJobs}</Text>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <SectionHeader title="Opportunity Summary" description="Current insight findings." />
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">Storewide Opportunities</Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">{insight.storewideOpportunities.length}</Text>
                </InlineStack>
                <Divider />
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">Products With Content Gaps</Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">{insight.contentGaps.length}</Text>
                </InlineStack>
                <Divider />
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">Competitor Mentions</Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    {insight.competitors.reduce((s, c) => s + c.count, 0)}
                  </Text>
                </InlineStack>
                <Divider />
                <InlineStack align="space-between">
                  <Text as="p" variant="bodyMd">Est. Revenue at Risk</Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold" tone="critical">
                    ${formatNumber(insight.revenueOpportunity.estimatedLow)}–${formatNumber(insight.revenueOpportunity.estimatedHigh)}/mo
                  </Text>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Revenue event breakdown */}
        {eventTypeBreakdown.length > 0 ? (
          <Card>
            <BlockStack gap="300">
              <SectionHeader title="Recovery by Event Type" description="Estimated revenue recovered broken down by action category." />
              <BlockStack gap="200">
                {(eventTypeBreakdown as Array<{eventType: string; count: number; totalLow: number; totalHigh: number}>).filter(Boolean).map((row, idx) => (
                  <BlockStack key={row.eventType} gap="100">
                    {idx > 0 ? <Divider /> : null}
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="200">
                        <Text as="p" variant="bodyMd">{EVENT_TYPE_LABELS[row.eventType as RevenueEventType] ?? row.eventType}</Text>
                        <Badge tone="info">{`${row.count}×`}</Badge>
                      </InlineStack>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {`$${formatNumber(Math.round(row.totalLow))}–$${formatNumber(Math.round(row.totalHigh))}`}
                      </Text>
                    </InlineStack>
                  </BlockStack>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        ) : null}
      </BlockStack>
    </AppPage>
  );
}
