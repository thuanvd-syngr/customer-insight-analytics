import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData, useNavigation } from "@remix-run/react";
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
import { EMPTY_INSIGHT, normalizeInsightResult } from "~/lib/types";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";
import {
  BarChart,
  AppPage,
  ChartCard,
  DashboardSkeleton,
  EmptyInsight,
  OnboardingChecklist,
  PriorityBadge,
  SectionHeader,
  TrendChart,
  TrendIndicator,
  EmptyStateCard,
  moneyRange,
  type BarDatum,
} from "~/components";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  const latestRun = await getLatestRun(prisma, shop.id);
  const insight = normalizeInsightResult(parseRun(latestRun) ?? EMPTY_INSIGHT);
  const [importedMessages, orderCount] = await Promise.all([
    prisma.importedMessage.count({ where: { shopId: shop.id } }),
    prisma.shopifyOrder.count({ where: { shopId: shop.id } }),
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
    usage,
    plan,
    orderCount,
  });
}

export default function Dashboard() {
  const {
    insight,
    isEmpty,
    usage,
    plan,
    revenueOpportunity: revenue,
    recommendedActions,
    importedMessages,
    hasRun,
    orderCount,
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
        primaryAction={
          <Form method="post" action="/app/import">
            <input type="hidden" name="intent" value="sample" />
            <Button submit variant="primary">
              Load sample data
            </Button>
          </Form>
        }
        secondaryAction={<Button url="/app/import">Add customer questions</Button>}
      >
        <EmptyStateCard
          title="Import customer conversations to unlock insights"
          body="Analyze real questions from shoppers to find lost revenue, product content gaps, and publishable FAQ fixes."
          actionLabel="Open data hub"
          actionUrl="/app/import"
        />
        <OnboardingChecklist
          title="Get started"
          steps={[
            {
              title: "Import sample data",
              description: "Load realistic customer questions so you can explore revenue recovery instantly.",
              completed: importedMessages > 0,
              action: (
                <Form method="post" action="/app/import">
                  <input type="hidden" name="intent" value="sample" />
                  <Button submit variant="primary">
                    Load sample data
                  </Button>
                </Form>
              ),
            },
            {
              title: "Sync Shopify",
              description: "Bring products and store content into the analysis.",
              completed: importedMessages > 0,
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

  const frictionBars: BarDatum[] = insight.keywordGroups.slice(0, 8).map((group) => ({
    label: group.label,
    value: group.count,
    tone:
      group.frictionWeight >= 0.66
        ? "critical"
        : group.frictionWeight >= 0.33
          ? "warning"
          : "info",
  }));

  const hasRevenueEstimate = revenue.estimatedHigh > 0;
  const revenueDisplay = hasRevenueEstimate
      ? `${moneyRange(revenue.estimatedLow, revenue.estimatedHigh)}/mo`
    : "Recovery estimate pending";
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
      recommendedAction: "Sync Shopify data and answer delivery timing concerns.",
      ctaLabel: "Sync Shopify data",
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

  return (
    <AppPage
      title="Customer Insight Analytics"
      subtitle="Turn customer questions into revenue recovery actions."
      primaryAction={<Button url="/app/import" variant="primary">Run analysis</Button>}
      secondaryAction={<Button url="/app/import">Add customer questions</Button>}
    >
      {insight.messageCount > 0 && orderCount === 0 ? (
        <Banner tone="info" title="Revenue estimates need order data">
          <p>Sync orders or set average order value to unlock recovery estimates.</p>
          <InlineStack gap="200">
            <Button url="/app/import" variant="primary">Sync Shopify data</Button>
            <Button url="/app/settings">Set average order value</Button>
          </InlineStack>
        </Banner>
      ) : null}

      <div className="cia-revenue-overview">
        <BlockStack gap="500">
          <InlineStack align="space-between" blockAlign="start" gap="400">
            <BlockStack gap="150">
              <Text as="p" variant="bodySm" tone="subdued">
                Revenue Recovery Overview
              </Text>
              <div className="cia-hero-number">{revenueDisplay}</div>
              <Text as="p" variant="bodyMd" tone="subdued">
                {hasRevenueEstimate
                  ? "Estimated monthly recovery from customer questions that block purchase intent."
                  : "Connect order data to estimate recovery from shopper friction."}
              </Text>
            </BlockStack>
            <Button url={hasRevenueEstimate ? "/app/insights" : "/app/import"} variant="primary">
              {hasRevenueEstimate ? "View recovery plan" : "Connect order data"}
            </Button>
          </InlineStack>

          <div className="cia-metric-strip">
            <div className="cia-muted-panel">
              <div className="cia-eyebrow">Revenue At Risk</div>
              <Text as="p" variant="headingLg">
                {revenueDisplay}
              </Text>
            </div>
            <div className="cia-muted-panel">
              <div className="cia-eyebrow">Questions Imported</div>
              <Text as="p" variant="headingLg">
                {insight.messageCount.toLocaleString("en-US")}
              </Text>
            </div>
            <div className="cia-muted-panel">
              <div className="cia-eyebrow">Products Losing Confidence</div>
              <Text as="p" variant="headingLg">
                {productsAtRisk.toLocaleString("en-US")}
              </Text>
            </div>
            <div className="cia-muted-panel">
              <div className="cia-eyebrow">Competitor Threat</div>
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
            title="Revenue Recovery Queue"
            description="Prioritized fixes that turn repeated questions into checkout confidence."
            actionLabel="Open FAQ builder"
            actionUrl="/app/faq"
          />
          {recoveryQueue.map((action, index) => {
            const expectedOutcome = action.highEstimate > 0
              ? `${moneyRange(action.lowEstimate, action.highEstimate)}/mo recovery potential`
              : "Higher buyer confidence after adding the answer";
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
                  <Text as="p" variant="bodySm" tone="subdued">
                    Expected outcome: {expectedOutcome}
                  </Text>
                </BlockStack>
                <Button url={action.targetUrl} variant={index === 0 ? "primary" : undefined}>
                  {action.ctaLabel}
                </Button>
              </div>
            );
          })}
        </BlockStack>
      </div>

      <div className="cia-two-grid">
        <ChartCard title="Friction breakdown" subtitle="Where customers get stuck before buying">
          <BarChart data={frictionBars} tone="warning" limit={8} />
        </ChartCard>
        <ChartCard title="Weekly trend" subtitle="Daily message volume">
          <TrendChart points={insight.weeklyTrend} tone="info" height={120} />
        </ChartCard>
      </div>

      <div className="cia-two-grid">
        <ChartCard title="Products losing confidence" subtitle="Items customers ask about most before abandoning">
          {insight.productConfusion.length === 0 ? (
            <Text as="p" variant="bodySm" tone="subdued">
              Sync Shopify data and run analysis to see products with recovery potential.
            </Text>
          ) : (
            <BlockStack gap="300">
              {insight.productConfusion.slice(0, 5).map((product) => (
                <InlineStack
                  key={product.productTitle}
                  align="space-between"
                  blockAlign="center"
                  wrap={false}
                  gap="200"
                >
                  <Link to={`/app/products/${encodeURIComponent(product.productId ?? product.productTitle)}`}>
                    {product.productTitle}
                  </Link>
                  <Badge tone={product.confusionScore >= 50 ? "warning" : "info"}>
                    {`${product.mentionCount} customers`}
                  </Badge>
                </InlineStack>
              ))}
            </BlockStack>
          )}
        </ChartCard>
        <ChartCard title="Customer question opportunities" subtitle="Answer these to recover the most revenue">
          {insight.questionOpportunities.length === 0 ? (
            <Text as="p" variant="bodySm" tone="subdued">
              Add customer questions to reveal recovery actions.
            </Text>
          ) : (
            <BlockStack gap="300">
              {insight.questionOpportunities.slice(0, 5).map((item) => (
                <InlineStack
                  key={item.groupId}
                  align="space-between"
                  blockAlign="center"
                  wrap={false}
                  gap="200"
                >
                  <Text as="span" variant="bodyMd">
                    {item.suggestedAction}
                  </Text>
                  <InlineStack gap="200" blockAlign="center" wrap={false}>
                    <PriorityBadge level={item.severity} />
                    <Badge tone="success">{`${moneyRange(item.lowEstimate, item.highEstimate)}/mo`}</Badge>
                  </InlineStack>
                </InlineStack>
              ))}
            </BlockStack>
          )}
        </ChartCard>
      </div>
    </AppPage>
  );
}
