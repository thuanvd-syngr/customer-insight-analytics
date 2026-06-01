import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  DataTable,
  EmptyState,
  InlineGrid,
  Layout,
  Page,
  ProgressBar,
  Text,
} from "@shopify/polaris";

import prisma from "~/db.server";
import { getDevPlanOverride, resolvePlan, type PlanId, getUsageSnapshot } from "~/lib/billing";
import { EMPTY_INSIGHT } from "~/lib/types";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  const latestRun = await getLatestRun(prisma, shop.id);
  const insight = parseRun(latestRun) ?? EMPTY_INSIGHT;
  const importedMessages = await prisma.importedMessage.count({ where: { shopId: shop.id } });
  const isProduction = process.env.NODE_ENV === "production";
  const plan = resolvePlan({
    activePlanId: shop.plan as PlanId,
    devOverride: getDevPlanOverride(),
    devOverrideEnabled: process.env.ENABLE_DEV_PLAN_OVERRIDE === "true",
    isProduction,
  });
  const usage = await getUsageSnapshot(prisma, shop.id, plan, new Date());
  return json({ insight, importedMessages, hasRun: Boolean(latestRun), usage, plan });
}

export default function Dashboard() {
  const { insight, importedMessages, hasRun, usage, plan } = useLoaderData<typeof loader>();
  const isEmpty = !hasRun && importedMessages === 0;

  if (isEmpty) {
    return (
      <Page title="Customer Insight Analytics">
        <EmptyState
          heading="Find why customers don't buy"
          action={{ content: "Load sample data", url: "/app/import" }}
          secondaryAction={{ content: "Import messages", url: "/app/import" }}
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">Start with sample data, run an analysis, then review insights.</Text>
            <Form method="post" action="/app/import">
              <input type="hidden" name="intent" value="sample" />
              <Button submit>Load sample data</Button>
            </Form>
          </BlockStack>
        </EmptyState>
      </Page>
    );
  }

  return (
    <Page title="Dashboard" primaryAction={{ content: "Run analysis", url: "/app/import" }}>
      <Layout>
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Insight score</Text>
                <Text as="p" variant="heading2xl">{insight.insightScore}/100</Text>
                <ProgressBar progress={insight.insightScore} tone="primary" />
                <Badge tone={insight.insightScore >= 70 ? "success" : "warning"}>{plan}</Badge>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Messages</Text>
                <Text as="p" variant="heading2xl">{insight.messageCount}</Text>
                <Text as="p" variant="bodySm">Monthly usage {usage.messagesThisMonth}</Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Analyses</Text>
                <Text as="p" variant="heading2xl">{usage.analysesThisWeek}</Text>
                <Text as="p" variant="bodySm">This ISO week</Text>
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>
        {insight.revenueLeakage.map((alert) => (
          <Layout.Section key={alert.groupId}>
            <Banner tone={alert.severity === "high" ? "critical" : "warning"} title={alert.label}>
              <p>{alert.message}</p>
            </Banner>
          </Layout.Section>
        ))}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Top customer questions</Text>
              <DataTable
                columnContentTypes={["text", "numeric"]}
                headings={["Question", "Mentions"]}
                rows={insight.topQuestions.map((q) => [q.text, q.count])}
              />
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
            <Card>
              <Text as="h2" variant="headingMd">Products with confusion</Text>
              <DataTable
                columnContentTypes={["text", "numeric"]}
                headings={["Product", "Score"]}
                rows={insight.productConfusion.slice(0, 5).map((p) => [p.productTitle, p.confusionScore])}
              />
            </Card>
            <Card>
              <Text as="h2" variant="headingMd">FAQ opportunities</Text>
              <DataTable
                columnContentTypes={["text", "numeric"]}
                headings={["Question", "Priority"]}
                rows={insight.faqOpportunities.slice(0, 5).map((f) => [f.question, f.priority])}
              />
            </Card>
          </InlineGrid>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Weekly trend</Text>
              {insight.weeklyTrend.map((point) => (
                <Text as="p" variant="bodySm" key={point.date}>
                  {point.date}: {"#".repeat(Math.max(1, point.count))}
                </Text>
              ))}
              <Link to="/app/insights">View all insights</Link>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
