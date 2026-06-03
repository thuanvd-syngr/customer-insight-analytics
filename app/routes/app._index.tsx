import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useFetcher, useLoaderData, useNavigation, useRevalidator } from "@remix-run/react";
import { useEffect } from "react";
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
import { getPublishedCounts } from "~/lib/publish/shopify-publisher.server";
import { isSampleDataEnabled } from "~/lib/sample-data";
import { isReviewerMode, buildSampleInsight } from "~/lib/reviewer-mode.server";
import { authenticate } from "~/shopify.server";
import { ANALYSIS_MESSAGE_LIMIT, parseStringArray } from "~/lib/utils";
import {
  checkExpiringOfflineTokenForAction,
  checkScopesForAction,
  REQUIRED_SYNC_SCOPES,
} from "~/lib/scope-guard.server";
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

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { session, admin } = await authenticate.admin(request);
    const form = await request.formData();
    if (String(form.get("intent")) !== "auto-sync") {
      return json({ ok: false as const, error: "Unknown intent" });
    }
    const shop = await ensureShop(prisma, session.shop);
    const tokenCheck = checkExpiringOfflineTokenForAction(session);
    if (!tokenCheck.ok) {
      return json({
        ok: false as const,
        error: `${tokenCheck.reason} Open the data hub to reauthorize and sync again.`,
      });
    }
    const scopeCheck = checkScopesForAction(session, REQUIRED_SYNC_SCOPES);
    if (!scopeCheck.ok) {
      const missing = scopeCheck.missing.join(", ");
      return json({
        ok: false as const,
        error: `Store data sync requires reauthorization. Missing scopes: ${missing}. Open the data hub to reauthorize and sync again.`,
      });
    }
    const autoSync = await syncShopifyData(prisma, shop.id, admin, {
      shopDomain: shop.shopDomain,
      grantedScopes: session.scope,
      accessToken: session.accessToken,
    });
    const [stored, storedProducts, settings, totalProductCount] = await Promise.all([
      prisma.importedMessage.findMany({
        where: { shopId: shop.id },
        take: ANALYSIS_MESSAGE_LIMIT,
        orderBy: { occurredAt: "desc" },
      }),
      prisma.shopifyProduct.findMany({ where: { shopId: shop.id }, orderBy: { updatedAt: "desc" }, take: 1000 }),
      prisma.appSetting.findMany({ where: { shopId: shop.id } }),
      prisma.shopifyProduct.count({ where: { shopId: shop.id } }),
    ]);
    if (stored.length > 0 || storedProducts.length > 0) {
      const settingValues = Object.fromEntries(settings.map((s) => [s.key, s.value]));
      const competitorTerms = String(settingValues.competitorTerms ?? "")
        .split(/[\n,]/)
        .map((t) => t.trim())
        .filter(Boolean);
      await saveInsightRun(prisma, shop.id, runAnalysis({
        messages: stored.map((m) => ({
          id: m.id,
          content: m.content,
          occurredAt: m.occurredAt,
          source: m.source,
          customerRef: m.customerRef,
          externalId: m.externalId,
        })),
        products: storedProducts.map((p) => ({
          id: p.externalId,
          title: p.title,
          handle: p.handle ?? undefined,
          vendor: p.vendor,
          updatedAt: p.shopifyUpdatedAt,
          description: p.description ?? "",
          tags: parseStringArray(p.tags),
          productType: p.productType,
          collections: parseStringArray(p.collections),
        })),
        competitorTerms,
        now: new Date(),
        windowDays: 30,
      }), 30, totalProductCount);
      await markOnboarded(prisma, shop.id);
    }
    const dataFound = (autoSync.products.count ?? 0) > 0 || (autoSync.messages ?? 0) > 0;
    const syncErrors = [
      autoSync.products.ok ? null : `Products: ${autoSync.products.error ?? autoSync.products.reason ?? "Shopify API returned an error"}`,
      autoSync.orders.ok || autoSync.orders.skipped ? null : `Orders: ${autoSync.orders.error ?? autoSync.orders.reason ?? "Shopify API returned an error"}`,
    ].filter(Boolean) as string[];
    const messageLimited = stored.length === ANALYSIS_MESSAGE_LIMIT;
    return json({ ok: true as const, dataFound, autoSync, syncErrors, messageLimited });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Auto-sync action failed", error);
    return json({ ok: false as const, error: "Auto-sync failed. Try syncing manually from the data hub." });
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shop = await ensureShop(prisma, session.shop);
    const tokenCheck = checkExpiringOfflineTokenForAction(session);
    const latestRun = await getLatestRun(prisma, shop.id);
    const existingLocalData = await prisma.importedMessage.count({ where: { shopId: shop.id } });
    const autoSyncNeeded = tokenCheck.ok && !latestRun && existingLocalData === 0;
    const sampleMode = !latestRun && existingLocalData === 0
      ? await isReviewerMode(prisma, shop.id)
      : false;
    const insight = normalizeInsightResult(
      sampleMode ? buildSampleInsight() : (parseRun(latestRun) ?? EMPTY_INSIGHT),
    );
    const [importedMessages, orderCount, productCount, publishedCounts] = await Promise.all([
      prisma.importedMessage.count({ where: { shopId: shop.id } }),
      prisma.shopifyOrder.count({ where: { shopId: shop.id } }),
      prisma.shopifyProduct.count({ where: { shopId: shop.id } }),
      getPublishedCounts(prisma, shop.id),
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
      ...buildDashboardViewModel({ insight, importedMessages, hasRun: Boolean(latestRun) || sampleMode }),
      orderCount,
      productCount,
      publishedTotal: publishedCounts.total,
      autoSyncNeeded,
      reauthorizeRequired: !tokenCheck.ok,
      reauthorizeUrl: tokenCheck.ok ? null : tokenCheck.reauthorizeUrl,
      reauthorizeReason: tokenCheck.ok ? null : tokenCheck.reason,
      loadError: null,
      sampleDataEnabled: isSampleDataEnabled(),
      isSampleMode: sampleMode,
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Dashboard loader failed", error);
    return json({
      ...buildDashboardViewModel({ insight: EMPTY_INSIGHT, importedMessages: 0, hasRun: false }),
      orderCount: 0,
      productCount: 0,
      publishedTotal: 0,
      autoSyncNeeded: false,
      reauthorizeRequired: false,
      reauthorizeUrl: null,
      reauthorizeReason: null,
      loadError: "Store data is loading. Refresh in a moment to see your recovery insights.",
      sampleDataEnabled: isSampleDataEnabled(),
      isSampleMode: false,
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
    publishedTotal,
    autoSyncNeeded,
    reauthorizeRequired,
    reauthorizeUrl,
    reauthorizeReason,
    loadError,
    sampleDataEnabled,
    isSampleMode,
  } = useLoaderData<typeof loader>();

  const syncer = useFetcher<typeof action>();
  const revalidator = useRevalidator();

  useEffect(() => {
    if (autoSyncNeeded && syncer.state === "idle" && !syncer.data) {
      syncer.submit({ intent: "auto-sync" }, { method: "post" });
    }
  }, [autoSyncNeeded, syncer]);

  useEffect(() => {
    if (syncer.state === "idle" && syncer.data && "ok" in syncer.data && syncer.data.ok && syncer.data.dataFound) {
      revalidator.revalidate();
    }
  }, [syncer.state, syncer.data, revalidator]);

  const isSyncing = syncer.state !== "idle" || (autoSyncNeeded && !syncer.data);
  const syncAttempted = Boolean(syncer.data);
  const syncError = syncer.data && "ok" in syncer.data && !syncer.data.ok
    ? (syncer.data as { ok: false; error: string }).error
    : syncer.data && "ok" in syncer.data && syncer.data.ok && "syncErrors" in syncer.data
      ? (syncer.data as { syncErrors?: string[] }).syncErrors?.join(" ")
    : null;
  const messageLimited = syncer.data && "ok" in syncer.data && syncer.data.ok && "messageLimited" in syncer.data
    ? (syncer.data as { messageLimited?: boolean }).messageLimited
    : false;

  const navigation = useNavigation();
  if (navigation.state === "loading" || isSyncing) {
    return <DashboardSkeleton />;
  }

  if (isEmpty) {
    return (
      <AppPage
        title="Revenue Recovery Dashboard"
        subtitle="Turn customer questions into recovered revenue."
        primaryAction={<Button url="/app/import" variant="primary">Import Your Store Data</Button>}
        secondaryAction={<Button url="/app/import">Add Customer Questions</Button>}
      >
        {loadError ? (
          <Banner tone="info" title="Store data is loading">
            <p>Refresh in a moment to see your recovery insights.</p>
          </Banner>
        ) : null}
        {syncError ? (
          <Banner tone="warning" title="Data sync needs attention">
            <p>{syncError}</p>
          </Banner>
        ) : null}
        {reauthorizeRequired ? (
          <Banner tone="warning" title="Reconnect Shopify sync">
            <p>{reauthorizeReason}</p>
            <InlineStack gap="200">
              <Button url={reauthorizeUrl ?? "/app/import"} variant="primary">Reauthorize Shopify</Button>
            </InlineStack>
          </Banner>
        ) : null}
        <EmptyStateCard
          title={syncAttempted ? "Let's connect your store data to begin finding revenue opportunities" : "Turn customer questions into recovered revenue"}
          body={syncAttempted
            ? "Import customer questions and sync your products to discover the buying objections costing you sales."
            : "Import your store data to identify questions blocking purchases and estimate the revenue you could recover."}
          actionLabel="Import Store Data"
          actionUrl="/app/import"
        />
        <OnboardingChecklist
          title="4 steps to your first recovered sale"
          steps={[
            ...(sampleDataEnabled
              ? [{
                  title: "Load sample data",
                  description: "Explore the full workflow using demo data from a development store.",
                  completed: false,
                  actionLabel: "Load sample data",
                  actionUrl: "/app/import",
                }]
              : []),
            {
              title: "Step 1 — Import Your Data",
              description: "Bring in customer questions, products, and order history so the engine can find what's costing you sales.",
              completed: productCount > 0 || orderCount > 0,
              actionLabel: "Import data",
              actionUrl: "/app/import",
            },
            {
              title: "Step 2 — Analyze Buying Questions",
              description: "Run the revenue analysis to discover which questions are blocking purchases and how much they cost you.",
              completed: hasRun,
              actionLabel: "Run analysis",
              actionUrl: "/app/import",
            },
            {
              title: "Step 3 — Generate Recovery Content",
              description: "Create FAQ answers and content pages targeting the highest-value customer concerns.",
              completed: false,
              actionLabel: "Generate answers",
              actionUrl: "/app/faq",
            },
            {
              title: "Step 4 — Publish to Your Store",
              description: "Push FAQ pages and blog articles live to Shopify — one click per content type.",
              completed: publishedTotal > 0,
              actionLabel: "Publish content",
              actionUrl: "/app/publish",
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
  const storewideOpportunityCount = insight.storewideOpportunities.length;
  const productOpportunityCount = insight.contentGaps.length + insight.productConfusion.length;
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
      title="Revenue Recovery Dashboard"
      subtitle="Turn customer questions into recovered revenue."
      primaryAction={<Button url="/app/import" variant="primary">Find Revenue Opportunities</Button>}
      secondaryAction={<Button url="/app/import">Add Customer Questions</Button>}
    >
      {isSampleMode ? (
        <Banner tone="info" title="Sample data — showing a demo recovery plan">
          <p>
            Your store has no customer questions yet. This dashboard shows example data so you
            can explore the full recovery workflow. Import real questions to see your actual opportunities.
          </p>
          <InlineStack gap="200">
            <Button url="/app/import" variant="primary">Import Customer Questions</Button>
          </InlineStack>
        </Banner>
      ) : null}
      {!isSampleMode && insight.messageCount > 0 && orderCount === 0 ? (
        <Banner tone="info" title="Connect order history to unlock revenue estimates">
          <p>Sync your orders so we can show you exactly how much revenue each customer question is costing you.</p>
          <InlineStack gap="200">
            <Button url="/app/import" variant="primary">Sync Order History</Button>
            <Button url="/app/settings">Set Average Order Value</Button>
          </InlineStack>
        </Banner>
      ) : null}
      {messageLimited ? (
        <Banner tone="info" title="Large message volume — analysis uses most recent 10,000">
          <p>Your store has more than 10,000 imported messages. Analysis is based on the most recent 10,000 for performance.</p>
        </Banner>
      ) : null}
      {reauthorizeRequired ? (
        <Banner tone="warning" title="Reconnect Shopify sync">
          <p>{reauthorizeReason}</p>
          <InlineStack gap="200">
            <Button url={reauthorizeUrl ?? "/app/import"} variant="primary">Reauthorize Shopify</Button>
          </InlineStack>
        </Banner>
      ) : null}

      <div className="cia-revenue-overview">
        <BlockStack gap="500">
          <div className="cia-command-hero">
            <ScoreGauge
              score={insight.insightScore}
              label="Store Revenue Health"
              caption="Higher means fewer unanswered buying objections"
              tone={insight.insightScore < 40 ? "critical" : insight.insightScore < 70 ? "warning" : "success"}
            />
            <BlockStack gap="150">
              <Text as="p" variant="bodySm" tone="subdued">
                Revenue You Could Recover
              </Text>
              <div className="cia-hero-number">{revenueDisplay}</div>
              <Text as="p" variant="bodyMd" tone="subdued">
                {hasRevenueEstimate
                  ? "Estimated monthly revenue at risk from customer questions that block purchase intent."
                  : "Import conversations and connect order data to estimate lost sales."}
              </Text>
              <InlineStack gap="200">
                <Button url="/app/insights" variant="primary">See Lost Sales Opportunities</Button>
                <Button url="/app/faq">Generate Recovery Content</Button>
              </InlineStack>
            </BlockStack>
          </div>

          <div className="cia-metric-strip">
            <div className="cia-muted-panel">
              <div className="cia-eyebrow">Products Synced</div>
              <Text as="p" variant="headingLg">
                {formatNumber(productCount)}
              </Text>
            </div>
            <div className="cia-muted-panel">
              <div className="cia-eyebrow">Questions Imported</div>
              <Text as="p" variant="headingLg">
                {formatNumber(importedMessages)}
              </Text>
            </div>
            <div className="cia-muted-panel">
              <div className="cia-eyebrow">Questions Blocking Sales</div>
              <Text as="p" variant="headingLg">
                {formatNumber(storewideOpportunityCount)}
              </Text>
            </div>
            <div className="cia-muted-panel">
              <div className="cia-eyebrow">Products Needing Attention</div>
              <Text as="p" variant="headingLg">
                {formatNumber(productOpportunityCount)}
              </Text>
            </div>
            <div className="cia-muted-panel">
              <div className="cia-eyebrow">Content Live on Store</div>
              <Text as="p" variant="headingLg">
                {formatNumber(publishedTotal)}
              </Text>
            </div>
          </div>
        </BlockStack>
      </div>

      <div className="cia-section-band">
        <BlockStack gap="300">
          <SectionHeader
            title="What's costing you sales right now?"
            description="Start with the highest-impact buying objection. Each one fixed means more buyers completing purchase."
            actionLabel="Generate Recovery Content"
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
                  Create Answer
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
          label="Top product to fix"
          value={insight.productConfusion[0]?.productTitle ?? "Sync products"}
          detail="Highest priority for recovery"
          tone="warning"
        />
        <KpiCard
          label="Top question to answer"
          value={insight.questionOpportunities[0]?.label ?? "Analyze questions"}
          detail="Most valuable buyer concern"
          tone="info"
        />
        <KpiCard
          label="Best first action"
          value={recoveryQueue[0]?.title ?? "Generate recovery content"}
          detail="Fastest path to recovered revenue"
          tone="success"
        />
      </div>
    </AppPage>
  );
}
