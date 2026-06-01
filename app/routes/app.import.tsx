import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import {
  BlockStack,
  Button,
  Card,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { useState } from "react";

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
import { syncShopifyData } from "~/lib/shopify-data.server";
import {
  buildSampleAnalysisInput,
  filterNewSampleMessages,
  getSampleMessages,
  SAMPLE_PAGES,
} from "~/lib/sample-data";
import { ensureShop, markOnboarded, saveInsightRun } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";
import { AppPage, KpiCard, SectionHeader } from "~/components";

async function shopContext(request: Request) {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  const isProduction = process.env.NODE_ENV === "production";
  const plan = resolvePlan({
    activePlanId: shop.plan as PlanId,
    devOverride: getDevPlanOverride(),
    devOverrideEnabled: process.env.ENABLE_DEV_PLAN_OVERRIDE === "true",
    isProduction,
  });
  return { shop, plan, admin };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { shop, plan } = await shopContext(request);
  const usage = await getUsageSnapshot(prisma, shop.id, plan, new Date());
  const recentMessageCount = await prisma.importedMessage.count({ where: { shopId: shop.id } });
  return json({ usage, plan, recentMessageCount });
}

export async function action({ request }: ActionFunctionArgs) {
  const { shop, plan, admin } = await shopContext(request);
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

  if (intent === "sync") {
    await syncShopifyData(prisma, shop.id, admin);
    return redirect("/app/import");
  }

  if (intent === "analyze") {
    const gate = canRunAnalysis(usage);
    if (!gate.allowed) return json({ error: gate.reason }, { status: 403 });
    const stored = await prisma.importedMessage.findMany({ where: { shopId: shop.id } });
    const [storedProducts, settings] = await Promise.all([
      prisma.shopifyProduct.findMany({ where: { shopId: shop.id }, orderBy: { updatedAt: "desc" }, take: 100 }),
      prisma.appSetting.findMany({ where: { shopId: shop.id } }),
    ]);
    const settingValues = Object.fromEntries(settings.map((setting) => [setting.key, setting.value]));
    const competitorTerms = String(settingValues.competitorTerms ?? "")
      .split(/[\n,]/)
      .map((term) => term.trim())
      .filter(Boolean);
    const products = storedProducts.length
      ? storedProducts.map((product) => ({
          id: product.externalId,
          title: product.title,
          handle: product.handle ?? undefined,
          description: product.description ?? "",
        }))
      : [];
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
            products,
            pages: SAMPLE_PAGES,
            competitorTerms,
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
  const [source, setSource] = useState("manual");
  const busy = navigation.state !== "idle";
  return (
    <AppPage
      title="Data hub"
      subtitle="Connect Shopify data, import conversations, and run revenue analysis."
      primaryAction={
        <Form method="post">
          <input type="hidden" name="intent" value="analyze" />
          <Button variant="primary" submit loading={busy}>Run analysis</Button>
        </Form>
      }
    >
      <BlockStack gap="500">
        <div className="cia-section-band">
          <BlockStack gap="300">
            <SectionHeader
              title="Revenue recovery onboarding"
              description="Follow the workflow from raw customer questions to prepared conversion fixes."
            />
            {[
              ["1", "Import conversations", recentMessageCount > 0],
              ["2", "Analyze", false],
              ["3", "Generate actions", false],
              ["4", "Prepare fixes", false],
            ].map(([step, label, done]) => (
              <div className="cia-queue-row" key={String(step)}>
                <div className="cia-rank">{String(step)}</div>
                <BlockStack gap="050">
                  <Text as="h3" variant="headingSm">
                    {String(label)}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {done ? "Completed" : "Next step in the recovery workflow"}
                  </Text>
                </BlockStack>
                <Button url={step === "1" ? "/app/import" : step === "2" ? "/app/import" : "/app/faq"}>
                  {done ? "Review" : "Start"}
                </Button>
              </div>
            ))}
          </BlockStack>
        </div>

        <div className="cia-three-grid">
          <KpiCard
            label="Messages this month"
            value={usage.messagesThisMonth.toLocaleString("en-US")}
            detail={`${recentMessageCount} stored conversations`}
            tone="info"
          />
          <KpiCard
            label="Next step"
            value={recentMessageCount > 0 ? "Run analysis" : "Ready to analyze customer questions"}
            detail="Find revenue opportunities after data is loaded"
            tone="success"
          />
          <KpiCard
            label="Data status"
            value={recentMessageCount > 0 ? "Ready" : "Store health needs order history"}
            detail="Sync Shopify data or load sample messages"
            tone={recentMessageCount > 0 ? "success" : "warning"}
          />
        </div>

        <div className="cia-two-grid">
          <Card>
            <Form method="post">
              <BlockStack gap="300">
                <SectionHeader title="Connect Shopify data" description="Sync products, orders, and customers for product-level recovery insights." />
                <input type="hidden" name="intent" value="sync" />
                <Button submit loading={busy} variant="primary">Sync Shopify data</Button>
              </BlockStack>
            </Form>
          </Card>
          <Card>
            <Form method="post">
              <BlockStack gap="300">
                <SectionHeader title="Load sample data" description="Explore the revenue recovery workflow with realistic sample conversations." />
                <input type="hidden" name="intent" value="sample" />
                <Button submit loading={busy}>Load sample data</Button>
              </BlockStack>
            </Form>
          </Card>
        </div>

        <Card>
          <Form method="post">
            <BlockStack gap="300">
              <SectionHeader title="Add customer questions" description="Paste support messages, chats, emails, or CSV rows." />
              <input type="hidden" name="intent" value="import" />
              <Select
                label="Source"
                name="source"
                options={["manual", "csv", "chat", "email"]}
                value={source}
                onChange={setSource}
              />
              <TextField label="Messages or CSV" name="raw" multiline={8} autoComplete="off" />
              <Button submit loading={busy}>Add customer questions</Button>
            </BlockStack>
          </Form>
        </Card>

        <Card>
          <Form method="post">
            <BlockStack gap="300">
              <SectionHeader title="Run analysis" description="Run analysis to find revenue opportunities." />
              <input type="hidden" name="intent" value="analyze" />
              <Button variant="primary" submit loading={busy}>Run analysis</Button>
            </BlockStack>
          </Form>
        </Card>
      </BlockStack>
    </AppPage>
  );
}
