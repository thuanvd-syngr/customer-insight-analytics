import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { BlockStack, Button, Card, DataTable, Page, Text } from "@shopify/polaris";

import prisma from "~/db.server";
import { buildMockSummary, getAIProvider } from "~/lib/ai";
import {
  canExportReport,
  canGenerateAISummary,
  getDevPlanOverride,
  getUsageSnapshot,
  incrementUsage,
  monthPeriod,
  resolvePlan,
  type PlanId,
} from "~/lib/billing";
import { PLANS } from "~/lib/billing/plans";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";

async function context(request: Request) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  const isProduction = process.env.NODE_ENV === "production";
  const plan = resolvePlan({
    activePlanId: shop.plan as PlanId,
    devOverride: getDevPlanOverride(),
    devOverrideEnabled: process.env.ENABLE_DEV_PLAN_OVERRIDE === "true",
    isProduction,
  });
  return { shop, plan, shopDomain: session.shop };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { shop, plan } = await context(request);
  const [reports, latestRun] = await Promise.all([
    prisma.weeklyReport.findMany({ where: { shopId: shop.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    getLatestRun(prisma, shop.id),
  ]);
  return json({ reports, hasRun: Boolean(latestRun), plan, canExport: canExportReport(plan).allowed });
}

export async function action({ request }: ActionFunctionArgs) {
  const { shop, plan, shopDomain } = await context(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "export") {
    const gate = canExportReport(plan);
    if (!gate.allowed) return json({ error: gate.reason }, { status: 403 });
    const id = String(form.get("id") ?? "");
    const report = await prisma.weeklyReport.findFirst({ where: { id, shopId: shop.id } });
    if (!report) return json({ error: "Report not found" }, { status: 404 });
    return new Response(report.aiSummary ?? report.dataJson, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${id}.md"`,
      },
    });
  }

  const now = new Date();
  const usage = await getUsageSnapshot(prisma, shop.id, plan, now);
  const gate = canGenerateAISummary(usage);
  if (!gate.allowed) return json({ error: gate.reason }, { status: 403 });
  const run = await getLatestRun(prisma, shop.id);
  const insight = parseRun(run);
  if (!run || !insight) return redirect("/app/import");

  const weekEnd = now.toISOString().slice(0, 10);
  const weekStart = new Date(now.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
  const provider = getAIProvider();
  const useAI = PLANS[plan].features.aiWeeklySummary && provider.isConfigured();
  const input = { shopDomain, insight, weekStart, weekEnd };
  const aiSummary = useAI
    ? await provider.generateWeeklySummary(input)
    : buildMockSummary(input);
  await prisma.weeklyReport.create({
    data: {
      shopId: shop.id,
      runId: run.id,
      weekStart: new Date(weekStart),
      weekEnd: new Date(weekEnd),
      insightScore: insight.insightScore,
      dataJson: JSON.stringify(insight),
      aiSummary,
      aiProvider: useAI ? provider.id : "mock",
    },
  });
  if (useAI) await incrementUsage(prisma, shop.id, "ai_summaries", monthPeriod(now), 1);
  return redirect("/app/reports");
}

export default function Reports() {
  const { reports, hasRun, canExport } = useLoaderData<typeof loader>();
  return (
    <Page title="Reports">
      <BlockStack gap="400">
        <Card>
          <Form method="post">
            <input type="hidden" name="intent" value="summary" />
            <Button submit variant="primary" disabled={!hasRun}>Generate weekly summary</Button>
          </Form>
        </Card>
        <Card>
          <Text as="h2" variant="headingMd">Recent reports</Text>
          <DataTable
            columnContentTypes={["text", "numeric", "text", "text"]}
            headings={["Generated", "Score", "Provider", "Export"]}
            rows={reports.map((report) => [
              new Date(report.generatedAt).toLocaleDateString(),
              report.insightScore,
              report.aiProvider ?? "none",
              canExport ? (
                <Form method="post" key={report.id}>
                  <input type="hidden" name="intent" value="export" />
                  <input type="hidden" name="id" value={report.id} />
                  <Button submit>Export</Button>
                </Form>
              ) : "Pro only",
            ])}
          />
        </Card>
      </BlockStack>
    </Page>
  );
}
