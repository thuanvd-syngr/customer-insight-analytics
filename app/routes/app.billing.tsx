import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { Badge, BlockStack, Button, Card, InlineGrid, Page, Text } from "@shopify/polaris";

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
  const usage = await getUsageSnapshot(prisma, shop.id, plan, new Date());
  return json({
    plan,
    usage,
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
  const { plan, usage, isProduction, devOverride, billingTestMode } = useLoaderData<typeof loader>();
  return (
    <Page title="Billing">
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
        <InlineGrid columns={{ xs: 1, md: 4 }} gap="400">
          {Object.values(PLANS).map((item) => (
            <Card key={item.id}>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">{item.name}</Text>
                <Text as="p" variant="headingLg">${item.price}/mo</Text>
                <Text as="p" variant="bodyMd">{item.tagline}</Text>
                <Text as="p" variant="bodySm">{item.features.messagesPerMonth} messages/month</Text>
                <Text as="p" variant="bodySm">{item.features.analysesPerWeek} analyses/week</Text>
                {plan === item.id ? <Badge tone="success">Current</Badge> : null}
                {item.id !== "free" ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="subscribe" />
                    <input type="hidden" name="plan" value={item.id} />
                    <Button submit>Choose plan</Button>
                  </Form>
                ) : null}
              </BlockStack>
            </Card>
          ))}
        </InlineGrid>
        <Card>
          <Text as="p" variant="bodyMd">
            Current usage: {usage.messagesThisMonth} messages, {usage.analysesThisWeek} analyses this week.
          </Text>
        </Card>
      </BlockStack>
    </Page>
  );
}
