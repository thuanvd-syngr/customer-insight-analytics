import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Badge, BlockStack, Button, Card, DataTable, InlineGrid, Text } from "@shopify/polaris";

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
import { ensureShop, setShopPlan } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";
import { AppPage, KpiCard, MetricBadge, SectionHeader } from "~/components";

const VALUE_COPY: Record<PlanId, string[]> = {
  free: ["Basic insights", "100 messages", "Weekly analysis"],
  starter: ["Revenue opportunity", "Content gap detection", "Daily analysis"],
  growth: ["FAQ publishing", "Competitor intelligence", "Weekly reports"],
  pro: ["AI reports", "Bulk actions", "Executive exports"],
};

export async function loader({ request }: LoaderFunctionArgs) {
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
  const [usage, reportsGenerated, faqsPrepared] = await Promise.all([
    getUsageSnapshot(prisma, shop.id, plan, new Date()),
    prisma.weeklyReport.count({ where: { shopId: shop.id } }),
    prisma.generatedFaq.count({ where: { shopId: shop.id, status: { in: ["prepared", "published"] } } }),
  ]);
  return json({
    plan,
    usage,
    reportsGenerated,
    faqsPrepared,
    hasActivePayment: billingCheck.hasActivePayment,
    isProduction,
    devOverride: getDevPlanOverride(),
    billingTestMode: isBillingTestMode(),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { billing } = await authenticate.admin(request);
  const form = await request.formData();
  const id = String(form.get("plan")) as PlanId;
  if (!PLAN_IDS.includes(id)) return json({ error: "Unknown plan" }, { status: 400 });
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
  const { plan, usage, reportsGenerated, faqsPrepared, isProduction, devOverride, billingTestMode } = useLoaderData<typeof loader>();
  return (
    <AppPage
      title="Billing"
      subtitle="Choose the recovery workflow that matches your store volume."
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
              <KpiCard label="Plan" value={PLANS[plan].name} detail={`$${PLANS[plan].price}/mo`} tone="info" />
              <KpiCard label="Messages analyzed" value={usage.messagesThisMonth.toLocaleString("en-US")} detail="This month" tone="info" />
              <KpiCard label="Reports generated" value={reportsGenerated.toLocaleString("en-US")} detail="Executive summaries" tone="success" />
              <KpiCard label="FAQs prepared" value={faqsPrepared.toLocaleString("en-US")} detail="Ready for Shopify publishing review" tone="success" />
            </div>
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">Why Growth pays back</Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Growth connects revenue opportunities to FAQ drafts, competitor intelligence, and weekly reports so teams can prioritize fixes that recover more than the monthly plan cost.
                </Text>
              </BlockStack>
            </Card>
          </BlockStack>
        </div>

        <InlineGrid columns={{ xs: 1, sm: 2, lg: 4 }} gap="400">
          {Object.values(PLANS).map((item) => (
            <Card key={item.id}>
              <BlockStack gap="300">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">{item.name}</Text>
                  {item.id === "growth" ? <MetricBadge tone="success">Recommended</MetricBadge> : null}
                </BlockStack>
                <Text as="p" variant="headingLg">${item.price}/mo</Text>
                <Text as="p" variant="bodyMd">{item.tagline}</Text>
                {VALUE_COPY[item.id].map((feature) => (
                  <Text as="p" variant="bodySm" key={feature}>{feature}</Text>
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
