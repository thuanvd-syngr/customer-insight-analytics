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
import { ensureShop, getLatestRun } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";
import { AppPage, DashboardSkeleton, SectionHeader, formatNumber } from "~/components";
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
    const plan = shop.plan as PlanId;
    const planConfig = PLANS[plan];
    const features = planConfig?.features ?? {};

    // Recent activity
    const lastRun = await getLatestRun(prisma, shop.id);
    const publishedCount = await prisma.publishedContent.count({ where: { shopId: shop.id, status: "published" } });
    const faqCount = await prisma.generatedFaq.count({ where: { shopId: shop.id } });
    const messageCount = await prisma.importedMessage.count({ where: { shopId: shop.id } });
    const competitorCount = await prisma.competitor.count({ where: { shopId: shop.id } });

    return json({
      plan,
      planLabel: planConfig?.name ?? plan,
      features,
      lastRunAt: lastRun?.createdAt?.toISOString() ?? null,
      lastRunScore: lastRun?.insightScore ?? null,
      publishedCount,
      faqCount,
      messageCount,
      competitorCount,
      loadError: null,
    });
  } catch (error) {
    console.error("Status loader failed", error);
    return json({
      plan: "free",
      planLabel: "Free",
      features: {},
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

const FEATURE_DEFINITIONS = [
  { key: "weeklyReports", label: "Weekly Reports" },
  { key: "aiSummary", label: "AI Summaries" },
  { key: "bulkOptimize", label: "Bulk Optimize" },
  { key: "emailReports", label: "Email Reports" },
  { key: "competitorTracking", label: "Competitor Tracking" },
  { key: "revenueOpportunity", label: "Revenue Timeline" },
  { key: "productOptimizer", label: "Product Optimizer" },
  { key: "aiProductOptimize", label: "AI Copilot & Marketing" },
] as const;

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

  const enabledFeatureCount = FEATURE_DEFINITIONS.filter(
    (f) => (features as Record<string, boolean>)[f.key]
  ).length;

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
                  {`${enabledFeatureCount} / ${FEATURE_DEFINITIONS.length}`}
                </Text>
              </InlineStack>
              <ProgressBar
                progress={Math.round((enabledFeatureCount / FEATURE_DEFINITIONS.length) * 100)}
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
              {FEATURE_DEFINITIONS.map((f) => {
                const enabled = Boolean((features as Record<string, boolean>)[f.key]);
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
