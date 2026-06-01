import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  InlineStack,
  Text,
} from "@shopify/polaris";

import prisma from "~/db.server";
import { getDevPlanOverride, resolvePlan, type PlanId, getUsageSnapshot } from "~/lib/billing";
import { buildDashboardViewModel } from "~/lib/dashboard.server";
import { runAnalysis } from "~/lib/engine";
import { EMPTY_INSIGHT, normalizeInsightResult } from "~/lib/types";
import { ensureShop, getLatestRun, markOnboarded, parseRun, saveInsightRun } from "~/lib/shop.server";
import { syncShopifyData } from "~/lib/shopify-data.server";
import type { ShopifySyncResult } from "~/lib/shopify-data.server";
import { isSampleDataEnabled } from "~/lib/sample-data";
import { authenticate } from "~/shopify.server";
import {
  AppPage,
  DashboardSkeleton,
  formatNumber,
  KpiCard,
  OnboardingChecklist,
  PriorityBadge,
  SectionHeader,
  EmptyStateCard,
  ScoreGauge,
  moneyRange,
} from "~/components";

function parseStringArray(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

const EMPTY_SYNC: ShopifySyncResult = {
  products: { ok: false, count: 0, skipped: true },
  orders: { ok: false, count: 0, skipped: true },
  customers: { ok: false, count: 0, skipped: true, reason: "Protected customer data not approved" },
  messages: 0,
};

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { session, admin } = await authenticate.admin(request);
    const shop = await ensureShop(prisma, session.shop);
    let latestRun = await getLatestRun(prisma, shop.id);
    const existingLocalData = await prisma.importedMessage.count({ where: { shopId: shop.id } });
    let autoSync = { attempted: false, ...EMPTY_SYNC };
  if (!latestRun && existingLocalData === 0) {
    autoSync = { attempted: true, ...(await syncShopifyData(prisma, shop.id, admin)) };
    const [stored, storedProducts, settings] = await Promise.all([
      prisma.importedMessage.findMany({ where: { shopId: shop.id } }),
      prisma.shopifyProduct.findMany({ where: { shopId: shop.id }, orderBy: { updatedAt: "desc" }, take: 1000 }),
      prisma.appSetting.findMany({ where: { shopId: shop.id } }),
    ]);
    if (stored.length > 0 || storedProducts.length > 0) {
      const settingValues = Object.fromEntries(settings.map((setting) => [setting.key, setting.value]));
      const competitorTerms = String(settingValues.competitorTerms ?? "")
        .split(/[\n,]/)
        .map((term) => term.trim())
        .filter(Boolean);
      latestRun = await saveInsightRun(prisma, shop.id, runAnalysis({
        messages: stored.map((message) => ({
          id: message.id,
          content: message.content,
          occurredAt: message.occurredAt,
          source: message.source,
          customerRef: message.customerRef,
          externalId: message.externalId,
        })),
        products: storedProducts.map((product) => ({
          id: product.externalId,
          title: product.title,
          handle: product.handle ?? undefined,
          description: product.description ?? "",
          tags: parseStringArray(product.tags),
          productType: product.productType,
          collections: parseStringArray(product.collections),
        })),
        competitorTerms,
        now: new Date(),
        windowDays: 30,
      }));
      await markOnboarded(prisma, shop.id);
    }
  }
  const insight = normalizeInsightResult(parseRun(latestRun) ?? EMPTY_INSIGHT);
  const [importedMessages, orderCount, productCount] = await Promise.all([
    prisma.importedMessage.count({ where: { shopId: shop.id } }),
    prisma.shopifyOrder.count({ where: { shopId: shop.id } }),
    prisma.shopifyProduct.count({ where: { shopId: shop.id } }),
  ]);
  const isProduction = process.env.NODE_ENV === "production";
  const plan = resolvePlan({
    activePlanId: shop.plan as PlanId,
    devOverride: getDevPlanOverride(),
    devOverrideEnabled: process.env.ENABLE_DEV_PLAN_OVERRIDE === "true",
    isProduction,
  });
  const usage = await getUsageSnapshot(prisma, shop.id, plan, new Date());
  return json({
    ...buildDashboardViewModel({ insight, importedMessages, hasRun: Boolean(latestRun) }),
    orderCount,
    productCount,
    autoSync,
    loadError: null,
    sampleDataEnabled: isSampleDataEnabled(),
  });
  } catch (error) {
    console.error("Dashboard loader failed", error);
    return json({
      ...buildDashboardViewModel({ insight: EMPTY_INSIGHT, importedMessages: 0, hasRun: false }),
      orderCount: 0,
      productCount: 0,
      autoSync: { attempted: false, ...EMPTY_SYNC },
      loadError: "Some data could not be loaded. Your store data is safe. Try refreshing or run analysis again.",
      sampleDataEnabled: isSampleDataEnabled(),
    });
  }
}

export default function Dashboard() {
  const {
    insight,
    isEmpty,
    revenueOpportunity: revenue,
    recommendedActions,
    importedMessages,
    hasRun,
    orderCount,
    productCount,
    autoSync,
    loadError,
    sampleDataEnabled,
  } = useLoaderData<typeof loader>();

  const navigation = useNavigation();
  if (navigation.state === "loading") {
    return <DashboardSkeleton />;
  }

  if (isEmpty) {
    return (
      <AppPage
        title="Customer Insight Analytics"
        subtitle="Turn customer questions into revenue recovery actions."
        primaryAction={<Button url="/app/import" variant="primary">Sync product and order data</Button>}
        secondaryAction={<Button url="/app/import">Add customer questions</Button>}
      >
        {loadError ? (
          <Banner tone="warning" title="Some data could not be loaded">
            <p>Your store data is safe. Try refreshing or run analysis again.</p>
          </Banner>
        ) : null}
        <EmptyStateCard
          title={autoSync.attempted ? "No Shopify recovery data found yet" : "Sync product and order data to discover revenue opportunities"}
          body={autoSync.attempted
            ? "This store has no synced products or order notes that can be analyzed yet."
            : "Analyze products, order notes, and imported customer questions to identify the first recovery actions to take."}
          actionLabel="Open data hub"
          actionUrl="/app/import"
        />
        <OnboardingChecklist
          title="Get started"
          steps={[
            ...(sampleDataEnabled
              ? [{
                  title: "Import sample data",
                  description: "Optional fallback for exploring the workflow when a development store has no live data.",
                  completed: false,
                  actionLabel: "Load sample data",
                  actionUrl: "/app/import",
                }]
              : []),
            {
              title: "Sync Shopify",
              description: "Bring products and store content into the analysis.",
              completed: productCount > 0 || orderCount > 0,
              actionLabel: "Sync data",
              actionUrl: "/app/import",
            },
            {
              title: "Run analysis",
              description: "Find revenue opportunities and recommended fixes.",
              completed: hasRun,
              actionLabel: "Run analysis",
              actionUrl: "/app/import",
            },
            {
              title: "Prepare fixes",
              description: "Generate FAQs and content blocks for the highest-value gaps.",
              completed: false,
              actionLabel: "Open FAQ builder",
              actionUrl: "/app/faq",
            },
          ]}
        />
      </AppPage>
    );
  }

  const totalCompetitorMentions = insight.competitors.reduce((sum, c) => sum + (c.count || 0), 0);
  const competitorPressure = Math.min(
    100,
    Math.round((totalCompetitorMentions / Math.max(1, insight.messageCount)) * 100 * 4),
  );

  const hasRevenueEstimate = revenue.estimatedHigh > 0;
  const revenueDisplay = hasRevenueEstimate
      ? `${moneyRange(revenue.estimatedLow, revenue.estimatedHigh)}/mo`
    : "Connect orders to unlock recovery estimates";
  const productsAtRisk = insight.productConfusion.length;
  const fallbackActions = [
    {
      id: "payment",
      title: "Fix payment concerns",
      priority: "high" as const,
      mentions: 0,
      lowEstimate: 0,
      highEstimate: 0,
      recommendedAction: "Collect customer questions and clarify checkout/payment expectations.",
      ctaLabel: "Add customer questions",
      targetUrl: "/app/import",
    },
    {
      id: "shipping",
      title: "Add shipping FAQ",
      priority: "medium" as const,
      mentions: 0,
      lowEstimate: 0,
      highEstimate: 0,
      recommendedAction: "Sync product and order data and answer delivery timing concerns.",
      ctaLabel: "Sync product and order data",
      targetUrl: "/app/import",
    },
    {
      id: "return",
      title: "Clarify return policy",
      priority: "medium" as const,
      mentions: 0,
      lowEstimate: 0,
      highEstimate: 0,
      recommendedAction: "Prepare a concise return policy answer before shoppers leave.",
      ctaLabel: "Open FAQ builder",
      targetUrl: "/app/faq",
    },
  ];
  const recoveryQueue = (recommendedActions.length > 0 ? recommendedActions : fallbackActions).slice(0, 3);
  const productFixQueue = productCount > 0 ? insight.contentGaps.slice(0, 5) : [];

  return (
    <AppPage
      title="Customer Insight Analytics"
      subtitle="Turn customer questions into revenue recovery actions."
      primaryAction={<Button url="/app/import" variant="primary">Run revenue analysis</Button>}
      secondaryAction={<Button url="/app/import">Add customer questions</Button>}
    >
      {insight.messageCount > 0 && orderCount === 0 ? (
        <Banner tone="info" title="Connect orders to unlock recovery estimates">
          <p>Sync order history so the command center can show monthly revenue at risk.</p>
          <InlineStack gap="200">
            <Button url="/app/import" variant="primary">Sync product and order data</Button>
            <Button url="/app/settings">Set average order value</Button>
          </InlineStack>
        </Banner>
      ) : null}

      <div className="cia-revenue-overview">
        <BlockStack gap="500">
          <div className="cia-command-hero">
            <ScoreGauge
              score={insight.insightScore}
              label="Revenue Recovery Score"
              caption="Higher means fewer unresolved buying objections"
              tone={insight.insightScore < 40 ? "critical" : insight.insightScore < 70 ? "warning" : "success"}
            />
            <BlockStack gap="150">
              <Text as="p" variant="bodySm" tone="subdued">
                Revenue Recovery Command Center
              </Text>
              <div className="cia-hero-number">{revenueDisplay}</div>
              <Text as="p" variant="bodyMd" tone="subdued">
                {hasRevenueEstimate
                  ? "Estimated monthly revenue at risk from customer questions that block purchase intent."
                  : "Import conversations and connect order data to estimate lost sales."}
              </Text>
              <InlineStack gap="200">
                <Button url="/app/insights" variant="primary">View recovery plan</Button>
                <Button url="/app/faq">Create recovery content</Button>
              </InlineStack>
            </BlockStack>
          </div>

          <div className="cia-metric-strip">
            <div className="cia-muted-panel">
              <div className="cia-eyebrow">Revenue At Risk</div>
              <Text as="p" variant="headingLg">
                {revenueDisplay}
              </Text>
            </div>
            <div className="cia-muted-panel">
              <div className="cia-eyebrow">Customers Impacted</div>
              <Text as="p" variant="headingLg">
                {formatNumber(insight.messageCount)}
              </Text>
            </div>
            <div className="cia-muted-panel">
              <div className="cia-eyebrow">Products at Risk</div>
              <Text as="p" variant="headingLg">
                {formatNumber(productsAtRisk)}
              </Text>
            </div>
            <div className="cia-muted-panel">
              <div className="cia-eyebrow">Competitor Pressure</div>
              <Text as="p" variant="headingLg">
                {totalCompetitorMentions > 0 ? `${competitorPressure}/100` : "Not detected"}
              </Text>
            </div>
          </div>
        </BlockStack>
      </div>

      <div className="cia-section-band">
        <BlockStack gap="300">
          <SectionHeader
            title="What should I fix today?"
            description="Start with the product content gaps most likely to remove buying objections and recover monthly revenue."
            actionLabel="Create recovery content"
            actionUrl="/app/faq"
          />
          {productFixQueue.length > 0 ? productFixQueue.map((gap, index) => {
            const issue = gap.missingSections[0] ?? "Missing FAQ";
            return (
              <div className="cia-queue-row" key={`${gap.productId ?? gap.productTitle}-${issue}`}>
                <div className="cia-rank">{`#${index + 1}`}</div>
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="h3" variant="headingMd">
                      {gap.productTitle}
                    </Text>
                    <PriorityBadge level={gap.contentGapScore >= 67 ? "high" : gap.contentGapScore >= 34 ? "medium" : "low"} withLabel />
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {issue}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    {gap.recommendedActions[0] ?? `Generate ${issue}`}
                  </Text>
                  <InlineStack gap="300">
                    <BlockStack gap="050">
                      <Text as="span" variant="bodySm" tone="subdued">Expected impact</Text>
                      <div className="cia-action-impact">{gap.expectedImpact ?? (gap.estimatedHigh > 0 ? `+${moneyRange(gap.estimatedLow, gap.estimatedHigh)}/mo` : "Reduce support questions")}</div>
                    </BlockStack>
                    <BlockStack gap="050">
                      <Text as="span" variant="bodySm" tone="subdued">Time to fix</Text>
                      <Text as="span" variant="headingSm">{gap.timeToFix ?? "20 min"}</Text>
                    </BlockStack>
                  </InlineStack>
                </BlockStack>
                <Button url="/app/faq" variant={index === 0 ? "primary" : undefined}>
                  Generate Fix
                </Button>
              </div>
            );
          }) : recoveryQueue.map((action, index) => {
            return (
              <div className="cia-queue-row" key={action.id}>
                <div className="cia-rank">{`#${index + 1}`}</div>
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="h3" variant="headingMd">
                      {action.title}
                    </Text>
                    <PriorityBadge level={action.priority} withLabel />
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {action.mentions > 0
                      ? `${action.mentions} affected customers`
                      : "Add customer questions to reveal recovery actions"}
                  </Text>
                  <Text as="p" variant="bodyMd">
                    {action.recommendedAction}
                  </Text>
                  <InlineStack gap="300">
                    <BlockStack gap="050">
                      <Text as="span" variant="bodySm" tone="subdued">Potential impact</Text>
                      <div className="cia-action-impact">{action.highEstimate > 0 ? `+${moneyRange(action.lowEstimate, action.highEstimate)}/mo` : "Connect orders"}</div>
                    </BlockStack>
                    <BlockStack gap="050">
                      <Text as="span" variant="bodySm" tone="subdued">Time to fix</Text>
                      <Text as="span" variant="headingSm">{index === 0 ? "15 min" : index === 1 ? "25 min" : "30 min"}</Text>
                    </BlockStack>
                  </InlineStack>
                </BlockStack>
                <Button url={action.targetUrl} variant={index === 0 ? "primary" : undefined}>
                  {action.ctaLabel}
                </Button>
              </div>
            );
          })}
        </BlockStack>
      </div>

      <div className="cia-three-grid">
        <KpiCard
          label="Next product to fix"
          value={insight.productConfusion[0]?.productTitle ?? "Sync products"}
          detail="Highest product recovery priority"
          tone="warning"
        />
        <KpiCard
          label="Top buying objection"
          value={insight.questionOpportunities[0]?.label ?? "Analyze questions"}
          detail="Most valuable customer concern"
          tone="info"
        />
        <KpiCard
          label="Fastest path to ROI"
          value={recoveryQueue[0]?.title ?? "Create recovery content"}
          detail="Recommended first fix"
          tone="success"
        />
      </div>
    </AppPage>
  );
}
