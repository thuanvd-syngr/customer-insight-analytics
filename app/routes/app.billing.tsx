import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Badge, Banner, BlockStack, Button, Card, DataTable, InlineGrid, InlineStack, Text } from "@shopify/polaris";

import prisma from "~/db.server";
import {
  getDevPlanOverride,
  getUsageSnapshot,
  isBillingTestMode,
  PLAN_IDS,
  PAID_PLAN_NAMES,
  PLANS,
  planIdFromName,
  resolvePlan,
  type PlanId,
} from "~/lib/billing";
import { ensureShop, getLatestRun, parseRun, setShopPlan } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";
import { AppPage, KpiCard, MetricBadge, SectionHeader, formatNumber, money } from "~/components";
import { safeCount } from "~/lib/prisma-safe";

const VALUE_COPY: Record<PlanId, string[]> = {
  free: ["Basic insights", "100 messages", "Weekly analysis"],
  starter: ["Revenue opportunity", "Content gap detection", "Daily analysis"],
  growth: ["FAQ publishing", "Competitor intelligence", "Weekly reports"],
  pro: ["AI reports", "Bulk actions", "Executive exports"],
};

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { session, billing } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  const isProduction = process.env.NODE_ENV === "production";
  const configuredPlan = resolvePlan({
    activePlanId: shop.plan as PlanId,
    devOverride: getDevPlanOverride(),
    devOverrideEnabled: process.env.ENABLE_DEV_PLAN_OVERRIDE === "true",
    isProduction,
  });
  const billingCheck = await billing.check({
    plans: PAID_PLAN_NAMES,
    isTest: isBillingTestMode(),
  });
  const activeBillingPlan = billingCheck.hasActivePayment
    ? planIdFromName(billingCheck.appSubscriptions[0]?.name)
    : "free";
  if (isProduction && activeBillingPlan !== shop.plan) {
    await setShopPlan(prisma, session.shop, activeBillingPlan);
  }
  const plan = isProduction ? activeBillingPlan : configuredPlan;
  const [usage, reportsGenerated, faqsPrepared, latestRun] = await Promise.all([
    getUsageSnapshot(prisma, shop.id, plan, new Date()),
    safeCount(prisma, "weeklyReport", { where: { shopId: shop.id } }),
    safeCount(prisma, "generatedFaq", { where: { shopId: shop.id, status: { in: ["prepared", "published"] } } }),
    getLatestRun(prisma, shop.id),
  ]);
  const latestInsight = parseRun(latestRun);
  return json({
    plan,
    usage,
    reportsGenerated,
    faqsPrepared,
    opportunitiesFound: latestInsight?.questionOpportunities.length ?? 0,
    roiEstimateHigh: latestInsight?.revenueOpportunity.estimatedHigh ?? 0,
    hasActivePayment: billingCheck.hasActivePayment,
    isProduction,
    devOverride: getDevPlanOverride(),
    billingTestMode: isBillingTestMode(),
    loadError: null,
  });
  } catch (error) {
    console.error("Billing loader failed", error);
    return json({
      plan: "free",
      usage: { plan: "free", messagesThisMonth: 0, analysesThisWeek: 0, aiSummariesThisMonth: 0 },
      reportsGenerated: 0,
      faqsPrepared: 0,
      opportunitiesFound: 0,
      roiEstimateHigh: 0,
      hasActivePayment: false,
      isProduction: process.env.NODE_ENV === "production",
      devOverride: getDevPlanOverride(),
      billingTestMode: isBillingTestMode(),
      loadError: "Usage information is being refreshed. Your plan details are shown below.",
    });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const { billing } = await authenticate.admin(request);
  const form = await request.formData();
  const id = String(form.get("plan")) as PlanId;
  if (!PLAN_IDS.includes(id)) return json({ error: "Plan not available" }, { status: 400 });
  if (String(form.get("intent")) === "subscribe" && id !== "free") {
    await billing.request({
      plan: PLANS[id].name,
      isTest: isBillingTestMode(),
      returnUrl: `${process.env.SHOPIFY_APP_URL}/app/billing`,
    });
  }
  return json({ ok: true });
}

export default function Billing() {
  const { plan, usage, reportsGenerated, faqsPrepared, opportunitiesFound, roiEstimateHigh, isProduction, devOverride, billingTestMode, loadError } = useLoaderData<typeof loader>();
  const currentPlan = PLAN_IDS.includes(plan as PlanId) ? plan as PlanId : "free";
  return (
    <AppPage
      title="Plans & Billing"
      subtitle="Most merchants on Growth recover $500–$2,000/mo in revenue. The plan pays for itself."
      primaryAction={
        plan !== "growth" ? (
          <Form method="post">
            <input type="hidden" name="intent" value="subscribe" />
            <input type="hidden" name="plan" value="growth" />
            <Button submit variant="primary">Upgrade to Growth</Button>
          </Form>
        ) : undefined
      }
    >
      <BlockStack gap="400">
        {loadError ? (
          <Banner tone="info" title="Usage data loading">
            <p>{loadError}</p>
          </Banner>
        ) : null}
        {!isProduction && devOverride ? (
          <Card>
            <Text as="p" variant="bodyMd">DEV_PLAN_OVERRIDE is active: {devOverride}</Text>
          </Card>
        ) : null}
        {!isProduction && billingTestMode ? (
          <Card>
            <Text as="p" variant="bodyMd">Billing test mode is active.</Text>
          </Card>
        ) : null}
        <div className="cia-section-band">
          <BlockStack gap="300">
            <SectionHeader
              title="Current Plan"
              description="Your current recovery workflow and usage this billing period."
            />
            <div className="cia-four-grid">
              <KpiCard label="Current Plan" value={PLANS[currentPlan].name} detail={`$${PLANS[currentPlan].price}/mo`} tone="info" />
              <KpiCard label="Messages Processed" value={formatNumber(usage.messagesThisMonth)} detail="This month" tone="info" />
              <KpiCard label="FAQs Created" value={formatNumber(faqsPrepared)} detail="Ready for Shopify review" tone="success" />
              <KpiCard label="Reports Generated" value={formatNumber(reportsGenerated)} detail="Weekly recovery reports" tone="success" />
              <KpiCard label="Revenue Opportunities Found" value={formatNumber(opportunitiesFound)} detail="From latest analysis" tone="warning" />
              <KpiCard label="ROI Estimate" value={roiEstimateHigh > 0 ? `${money(roiEstimateHigh)}/mo` : "Connect orders"} detail="Potential monthly recovery" tone="success" />
            </div>
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">Does the plan pay for itself?</Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Yes. Growth gives you FAQ publishing, competitor intelligence, and weekly recovery reports. Answering even one high-frequency buying objection typically recovers more than the monthly plan cost within the first week.
                </Text>
                <InlineStack gap="200" wrap>
                  <Badge tone="success">$49/mo Growth plan</Badge>
                  <Badge tone="info">Average merchant recovers $500–$2,000/mo</Badge>
                  <Badge tone="success">ROI in the first week</Badge>
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </div>

        <InlineGrid columns={{ xs: 1, sm: 2, lg: 4 }} gap="400">
          {Object.values(PLANS).map((item) => (
            <div className={item.id === "growth" ? "cia-plan-recommended" : undefined} key={item.id}>
            <Card>
              <BlockStack gap="300">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">{item.name}</Text>
                  {item.id === "growth" ? <MetricBadge tone="success">Recommended</MetricBadge> : null}
                </BlockStack>
                <Text as="p" variant="headingLg">${item.price}/mo</Text>
                <Text as="p" variant="bodyMd">{item.tagline}</Text>
                {VALUE_COPY[item.id].map((feature) => (
                  <div className="cia-plan-feature" key={feature}>
                    <Text as="p" variant="bodySm">{feature}</Text>
                  </div>
                ))}
                {plan === item.id ? <Badge tone="success">Current</Badge> : null}
                {item.id !== "free" ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="subscribe" />
                    <input type="hidden" name="plan" value={item.id} />
                    <Button submit variant={item.id === "growth" ? "primary" : undefined}>
                      {item.id === "growth" ? "Upgrade to Growth" : "Choose plan"}
                    </Button>
                  </Form>
                ) : null}
              </BlockStack>
            </Card>
            </div>
          ))}
        </InlineGrid>
        <div className="cia-section-band">
          <SectionHeader title="Plan comparison" description="Starter, Growth, and Pro unlock progressively stronger recovery workflows." />
          <DataTable
            columnContentTypes={["text", "text", "text", "text"]}
            headings={["Plan", "Core recovery value", "Operational workflow", "Best use"]}
            rows={[
              ["Free", "Basic insights", "Upgrade for revenue opportunity", "Upgrade for FAQ drafts"],
              ["Starter", "Revenue opportunity", "Content gap detection", "Daily analysis"],
              ["Growth", "FAQ publishing workflow", "Competitor intelligence", "Weekly reports"],
              ["Pro", "AI reports", "Bulk actions", "Executive exports"],
            ]}
          />
        </div>
      </BlockStack>
    </AppPage>
  );
}
