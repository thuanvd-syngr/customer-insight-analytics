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
import { ensureShop, getLatestRun, parseRun, setShopPlan } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";
import { AppPage, DashboardSkeleton, SectionHeader, formatNumber } from "~/components";
import { safeCount } from "~/lib/prisma-safe";
import { isBillingTestMode, PAID_PLAN_NAMES, planIdFromName, PLANS } from "~/lib/billing";
import type { PlanId } from "~/lib/billing";

async function getCtx(request: Request) {
  const { session, billing } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  return { shop, session, billing };
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { shop, session, billing } = await getCtx(request);
    const billingCheck = await billing.check({
      plans: PAID_PLAN_NAMES,
      isTest: isBillingTestMode(),
    });
    const activeBillingPlan = billingCheck.hasActivePayment
      ? planIdFromName(billingCheck.appSubscriptions[0]?.name)
      : "free";
    if (process.env.NODE_ENV === "production" && activeBillingPlan !== shop.plan) {
      await setShopPlan(prisma, session.shop, activeBillingPlan);
    }
    const plan = (process.env.NODE_ENV === "production" ? activeBillingPlan : shop.plan) as PlanId;
    const planConfig = PLANS[plan];
    const features = planConfig?.features ?? {};

    // Recent activity
    const lastRun = await getLatestRun(prisma, shop.id);
    const latestInsight = parseRun(lastRun);
    const [publishedCount, faqCount, messageCount] = await Promise.all([
      safeCount(prisma, "publishedContent", { where: { shopId: shop.id, status: "published" } }),
      safeCount(prisma, "generatedFaq", { where: { shopId: shop.id } }),
      safeCount(prisma, "importedMessage", { where: { shopId: shop.id } }),
    ]);
    const competitorCount = latestInsight?.competitors.length ?? 0;

    return json({
      plan,
      planLabel: planConfig?.name ?? plan,
      features: [
        { key: "weeklyReports", label: "Weekly Reports", enabled: Boolean(features.weeklyReports) },
        { key: "aiSummaries", label: "AI Summaries", enabled: Boolean(features.aiWeeklySummary) },
        { key: "bulkPublishing", label: "Bulk Actions", enabled: Boolean(features.bulkPublishing) },
        { key: "faqGeneration", label: "FAQ Generation", enabled: Boolean(features.faqGeneration) },
        { key: "competitorTracking", label: "Competitor Tracking", enabled: Boolean(features.competitorTracking) },
        { key: "revenueOpportunity", label: "Revenue Timeline", enabled: Boolean(features.revenueOpportunity) },
        { key: "faqPublishing", label: "Shopify Publishing", enabled: Boolean(features.faqPublishing) },
        { key: "executiveReports", label: "Executive Exports", enabled: Boolean(features.executiveReports) },
      ],
      lastRunAt: lastRun?.createdAt?.toISOString() ?? null,
      lastRunScore: lastRun?.insightScore ?? null,
      publishedCount,
      faqCount,
      messageCount,
      competitorCount,
      loadError: null,
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Status loader failed", error);
    return json({
      plan: "free",
      planLabel: "Free",
      features: [],
      lastRunAt: null,
      lastRunScore: null,
      publishedCount: 0,
      faqCount: 0,
      messageCount: 0,
      competitorCount: 0,
      loadError: "Could not load status. Try refreshing.",
    });
  }
}

export default function StatusPage() {
  const {
    plan,
    planLabel,
    features,
    lastRunAt,
    lastRunScore,
    publishedCount,
    faqCount,
    messageCount,
    competitorCount,
    loadError,
  } = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  if (navigation.state === "loading") return <DashboardSkeleton />;

  const featureRows = features.filter((feature): feature is NonNullable<typeof feature> => Boolean(feature));
  const enabledFeatureCount = featureRows.filter((feature) => feature.enabled).length;
  const featureTotal = featureRows.length || 1;

  return (
    <AppPage
      title="App Status"
      subtitle="Feature availability, plan summary, and store activity overview."
      primaryAction={<Button url="/app/health">Health Check</Button>}
      secondaryAction={<Button url="/app/billing">Manage Plan</Button>}
    >
      <BlockStack gap="500">
        {loadError ? <Banner tone="critical" title="Error"><p>{loadError}</p></Banner> : null}

        {/* Plan overview */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <SectionHeader title="Current Plan" description="Your plan and feature access." />
              <Badge tone={plan === "pro" ? "success" : plan === "growth" ? "info" : "warning"}>
                {planLabel}
              </Badge>
            </InlineStack>

            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="p" variant="bodyMd">Features Enabled</Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  {`${enabledFeatureCount} / ${featureRows.length}`}
                </Text>
              </InlineStack>
              <ProgressBar
                progress={Math.round((enabledFeatureCount / featureTotal) * 100)}
                size="small"
                tone={enabledFeatureCount >= 6 ? "success" : "primary"}
              />
            </BlockStack>
          </BlockStack>
        </Card>

        {/* Feature grid */}
        <Card>
          <BlockStack gap="300">
            <SectionHeader
              title="Feature Availability"
              description="Which features are unlocked on your current plan."
            />
            <InlineGrid columns={{ xs: 1, sm: 2 }} gap="200">
              {featureRows.map((f) => {
                const enabled = Boolean(f.enabled);
                return (
                  <InlineStack key={f.key} align="space-between" blockAlign="center" gap="200">
                    <Text as="p" variant="bodyMd">{f.label}</Text>
                    <Badge tone={enabled ? "success" : "warning"}>{enabled ? "Enabled" : "Upgrade"}</Badge>
                  </InlineStack>
                );
              })}
            </InlineGrid>
          </BlockStack>
        </Card>

        {/* Store activity */}
        <Card>
          <BlockStack gap="300">
            <SectionHeader title="Store Activity" description="Summary of data in your account." />
            <BlockStack gap="150">
              <InlineStack align="space-between">
                <Text as="p" variant="bodyMd">Messages Imported</Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">{formatNumber(messageCount)}</Text>
              </InlineStack>
              <Divider />
              <InlineStack align="space-between">
                <Text as="p" variant="bodyMd">FAQs Generated</Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">{formatNumber(faqCount)}</Text>
              </InlineStack>
              <Divider />
              <InlineStack align="space-between">
                <Text as="p" variant="bodyMd">Content Published</Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">{formatNumber(publishedCount)}</Text>
              </InlineStack>
              <Divider />
              <InlineStack align="space-between">
                <Text as="p" variant="bodyMd">Competitors Tracked</Text>
                <Text as="p" variant="bodyMd" fontWeight="semibold">{formatNumber(competitorCount)}</Text>
              </InlineStack>
              <Divider />
              <InlineStack align="space-between">
                <Text as="p" variant="bodyMd">Last Analysis</Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  {lastRunAt
                    ? `${new Date(lastRunAt).toLocaleDateString()} (score: ${lastRunScore}/100)`
                    : "Never run"}
                </Text>
              </InlineStack>
            </BlockStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </AppPage>
  );
}
