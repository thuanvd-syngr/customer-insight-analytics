import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import {
  BlockStack,
  Button,
  Card,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";

import prisma from "~/db.server";
import {
  canImportMessages,
  canRunAnalysis,
  getUsageSnapshot,
  getDevPlanOverride,
  incrementUsage,
  isoWeekPeriod,
  monthPeriod,
  resolvePlan,
  type PlanId,
} from "~/lib/billing";
import { parseImport } from "~/lib/import";
import { runAnalysis } from "~/lib/engine";
import {
  buildSampleAnalysisInput,
  filterNewSampleMessages,
  getSampleMessages,
  SAMPLE_PRODUCTS,
  SAMPLE_PAGES,
} from "~/lib/sample-data";
import { ensureShop, markOnboarded, saveInsightRun } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";

async function shopContext(request: Request) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  const isProduction = process.env.NODE_ENV === "production";
  const plan = resolvePlan({
    activePlanId: shop.plan as PlanId,
    devOverride: getDevPlanOverride(),
    devOverrideEnabled: process.env.ENABLE_DEV_PLAN_OVERRIDE === "true",
    isProduction,
  });
  return { shop, plan };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { shop, plan } = await shopContext(request);
  const usage = await getUsageSnapshot(prisma, shop.id, plan, new Date());
  const recentMessageCount = await prisma.importedMessage.count({ where: { shopId: shop.id } });
  return json({ usage, plan, recentMessageCount });
}

export async function action({ request }: ActionFunctionArgs) {
  const { shop, plan } = await shopContext(request);
  const now = new Date();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const usage = await getUsageSnapshot(prisma, shop.id, plan, now);

  if (intent === "sample") {
    const messages = getSampleMessages(now);
    const existing = await prisma.importedMessage.findMany({
      where: {
        shopId: shop.id,
        externalId: { in: messages.map((message) => message.externalId).filter(Boolean) as string[] },
      },
      select: { externalId: true },
    });
    const missing = filterNewSampleMessages(
      messages,
      existing.map((message) => message.externalId),
    );
    const gate = canImportMessages(usage, missing.length);
    if (!gate.allowed) return json({ error: gate.reason }, { status: 403 });
    if (missing.length > 0) {
      await prisma.importedMessage.createMany({
        data: missing.map((message) => ({
          shopId: shop.id,
          source: message.source,
          content: message.content,
          occurredAt: message.occurredAt,
          customerRef: message.customerRef,
          externalId: message.externalId,
        })),
      });
      await incrementUsage(prisma, shop.id, "messages", monthPeriod(now), missing.length);
    }
    return redirect("/app/import");
  }

  if (intent === "import") {
    const raw = String(form.get("raw") ?? "");
    const source = String(form.get("source") ?? "manual");
    const parsed = parseImport(raw, { source, now });
    const gate = canImportMessages(usage, parsed.length);
    if (!gate.allowed) return json({ error: gate.reason }, { status: 403 });
    await prisma.importedMessage.createMany({
      data: parsed.map((message) => ({
        shopId: shop.id,
        source: message.source,
        content: message.content,
        occurredAt: message.occurredAt,
        customerRef: message.customerRef,
        externalId: message.externalId,
      })),
    });
    await incrementUsage(prisma, shop.id, "messages", monthPeriod(now), parsed.length);
    return redirect("/app/import");
  }

  if (intent === "analyze") {
    const gate = canRunAnalysis(usage);
    if (!gate.allowed) return json({ error: gate.reason }, { status: 403 });
    const stored = await prisma.importedMessage.findMany({ where: { shopId: shop.id } });
    const input =
      stored.length === 0
        ? buildSampleAnalysisInput(now)
        : {
            messages: stored.map((message) => ({
              id: message.id,
              content: message.content,
              occurredAt: message.occurredAt,
              source: message.source,
              customerRef: message.customerRef,
              externalId: message.externalId,
            })),
            products: SAMPLE_PRODUCTS,
            pages: SAMPLE_PAGES,
            now,
            windowDays: 30,
          };
    await saveInsightRun(prisma, shop.id, runAnalysis(input));
    await incrementUsage(prisma, shop.id, "analyses", isoWeekPeriod(now), 1);
    await markOnboarded(prisma, shop.id);
    return redirect("/app");
  }

  return redirect("/app/import");
}

export default function ImportPage() {
  const { usage, recentMessageCount } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  return (
    <Page title="Import">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Usage</Text>
                <Text as="p" variant="bodyMd">
                  {usage.messagesThisMonth} messages this month. {recentMessageCount} stored messages.
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <Form method="post">
                <input type="hidden" name="intent" value="sample" />
                <Button submit loading={busy}>Load sample data</Button>
              </Form>
            </Card>
            <Card>
              <Form method="post">
                <BlockStack gap="300">
                  <input type="hidden" name="intent" value="import" />
                  <Select label="Source" name="source" options={["manual", "csv", "chat", "email"]} />
                  <TextField label="Messages or CSV" name="raw" multiline={8} autoComplete="off" />
                  <Button submit loading={busy}>Import messages</Button>
                </BlockStack>
              </Form>
            </Card>
            <Card>
              <Form method="post">
                <input type="hidden" name="intent" value="analyze" />
                <Button variant="primary" submit loading={busy}>Run analysis</Button>
              </Form>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
