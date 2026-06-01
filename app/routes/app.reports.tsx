import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import { Badge, BlockStack, Box, Button, Card, DataTable, Divider, InlineGrid, InlineStack, Text } from "@shopify/polaris";

import {
  AppPage,
  BarChart,
  EmptyInsight,
  formatNumber,
  ListSkeleton,
  MetricCard,
  money,
  moneyRange,
  PriorityBadge,
  SectionHeader,
  StickyActionBar,
  TrendIndicator,
  type BarDatum,
  type PriorityLevel,
} from "~/components";
import prisma from "~/db.server";
import { getAIProvider } from "~/lib/ai";
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
import {
  buildExecutiveHtmlReport,
  buildExecutiveReport,
  buildReportCsv,
  buildSimplePdf,
  buildWeeklyEmailHtml,
} from "~/lib/report-export.server";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { normalizeInsightResult } from "~/lib/types";
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
  // parseRun already returns a normalized InsightResult, so the executive view
  // can render straight from the latest analysis even before a report is saved.
  const latestInsight = latestRun ? parseRun(latestRun) : null;
  return json({
    reports,
    latestInsight,
    hasRun: Boolean(latestRun),
    plan,
    canExport: canExportReport(plan).allowed,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { shop, plan, shopDomain } = await context(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "export") {
    const gate = canExportReport(plan);
    if (!gate.allowed) return json({ error: gate.reason }, { status: 403 });
    const id = String(form.get("id") ?? "");
    const format = String(form.get("format") ?? "markdown");
    const report = await prisma.weeklyReport.findFirst({ where: { id, shopId: shop.id } });
    if (!report) return json({ error: "Report not found" }, { status: 404 });
    const insight = JSON.parse(report.dataJson);
    const markdown = report.aiSummary ?? buildExecutiveReport({
      shopDomain,
      insight,
      weekStart: report.weekStart.toISOString().slice(0, 10),
      weekEnd: report.weekEnd.toISOString().slice(0, 10),
    });
    if (format === "csv") {
      return new Response(buildReportCsv(insight), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${id}.csv"`,
        },
      });
    }
    if (format === "html" || format === "email-html") {
      const html = format === "email-html"
        ? buildWeeklyEmailHtml({
            shopDomain,
            insight,
            weekStart: report.weekStart.toISOString().slice(0, 10),
            weekEnd: report.weekEnd.toISOString().slice(0, 10),
          })
        : buildExecutiveHtmlReport({
            shopDomain,
            insight,
            weekStart: report.weekStart.toISOString().slice(0, 10),
            weekEnd: report.weekEnd.toISOString().slice(0, 10),
          });
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `attachment; filename="${id}-${format}.html"`,
        },
      });
    }
    if (format === "pdf") {
      return new Response(Buffer.from(buildSimplePdf(markdown)), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${id}.pdf"`,
        },
      });
    }
    return new Response(markdown, {
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
    : buildExecutiveReport(input);
  await prisma.weeklyReport.create({
    data: {
      shopId: shop.id,
      runId: run.id,
      weekStart: new Date(weekStart),
      weekEnd: new Date(weekEnd),
      insightScore: insight.insightScore,
      dataJson: JSON.stringify(insight),
      aiSummary,
      aiProvider: useAI ? provider.id : "rule",
    },
  });
  if (useAI) await incrementUsage(prisma, shop.id, "ai_summaries", monthPeriod(now), 1);
  return redirect("/app/reports");
}

const IMPACT_LEVEL: Record<string, PriorityLevel> = { low: "low", medium: "medium", high: "high" };

export default function Reports() {
  const { reports, latestInsight, hasRun, canExport } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  if (navigation.state === "loading") return <ListSkeleton />;

  const latest = reports[0];
  // Prefer the most recent saved report snapshot; fall back to the latest run
  // so the executive report is visible as soon as an analysis exists.
  const insight = latest
    ? normalizeInsightResult(JSON.parse(latest.dataJson))
    : (latestInsight ?? null);
  const revenue = insight?.revenueOpportunity ?? null;

  const productBars: BarDatum[] = (insight?.productConfusion ?? []).slice(0, 6).map((p) => ({
    label: p.productTitle,
    value: p.mentionCount,
    display: `${formatNumber(p.mentionCount)} mentions`,
    tone: p.confusionScore >= 67 ? "critical" : p.confusionScore >= 34 ? "warning" : "info",
  }));

  const driverBars: BarDatum[] = (revenue?.drivers ?? []).slice(0, 6).map((d) => ({
    label: d.label,
    value: d.revenueImpact,
    display: money(d.revenueImpact),
    tone: "critical",
  }));

  return (
    <AppPage
      title="Executive Revenue Report"
      subtitle="Weekly revenue recovery snapshot your team can act on."
      primaryAction={
        <Form method="post">
          <input type="hidden" name="intent" value="summary" />
          <Button submit variant="primary" disabled={!hasRun}>
            Generate weekly summary
          </Button>
        </Form>
      }
    >
      <BlockStack gap="500">
        {!hasRun || !insight || !revenue ? (
          <Card>
            <EmptyInsight
              heading="Executive report will appear here"
              primaryActionLabel="Import customer data"
              primaryActionUrl="/app/import"
              secondaryActionLabel="View dashboard"
              secondaryActionUrl="/app"
            >
              <p>Generate your first weekly summary once customer messages are analyzed. We will surface revenue at risk, top products, competitors, and recommended actions here.</p>
            </EmptyInsight>
          </Card>
        ) : (
          <>
            <BlockStack gap="300">
              <SectionHeader
              title="Revenue Recovery Summary"
                description={revenue.headline}
                trailing={
                  revenue.topFriction ? (
                    <TrendIndicator value={revenue.topFriction.trend7} suffix="top friction" />
                  ) : undefined
                }
              />
              <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
                <MetricCard
                  title="Revenue at risk"
                  value={moneyRange(revenue.estimatedLow, revenue.estimatedHigh)}
                  sublabel={revenue.summary}
                  tone="critical"
                  helpText="Estimated revenue tied to unresolved friction across the analysis window."
                />
                <MetricCard
                  title="Monthly at risk"
                  value={money(revenue.monthlyAtRisk)}
                  sublabel="Projected monthly run-rate"
                  tone="warning"
                />
                <MetricCard
                  title="Top friction"
                  value={revenue.topFriction ? revenue.topFriction.label : "Add customer questions"}
                  sublabel={
                    revenue.topFriction
                      ? `${formatNumber(revenue.topFriction.count)} mentions`
                      : "Add customer questions to reveal recovery actions"
                  }
                  trend={revenue.topFriction ? revenue.topFriction.trend7 : undefined}
                  tone="info"
                />
              </InlineGrid>
            </BlockStack>

            {driverBars.length > 0 ? (
              <BlockStack gap="300">
                <SectionHeader
                  title="Top Frictions"
                  description="Friction groups contributing the most estimated revenue impact"
                />
                <Card>
                  <BarChart data={driverBars} tone="critical" />
                </Card>
              </BlockStack>
            ) : null}

            <BlockStack gap="300">
              <SectionHeader
                title="Top Products"
                description="Products generating the most customer confusion"
              />
              <Card>
                {productBars.length > 0 ? (
                  <BarChart data={productBars} tone="info" />
                ) : (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Sync Shopify data and run analysis to identify products at risk.
                  </Text>
                )}
              </Card>
            </BlockStack>

            <BlockStack gap="300">
              <SectionHeader
                title="Competitor Threats"
                description="Competitor mentions surfaced in customer conversations"
              />
              <Card>
                {insight.competitors.length > 0 ? (
                  <BlockStack gap="300">
                    {insight.competitors.slice(0, 6).map((c, index) => (
                      <BlockStack key={`${c.name}-${index}`} gap="100">
                        {index > 0 ? <Divider /> : null}
                        <InlineStack align="space-between" blockAlign="center" wrap={false}>
                          <Text as="span" variant="bodyMd" fontWeight="semibold">
                            {c.name}
                          </Text>
                          <Badge tone="warning">{`${formatNumber(c.count)} mentions`}</Badge>
                        </InlineStack>
                        {c.exampleQuote ? (
                          <Text as="p" variant="bodySm" tone="subdued">
                            {`“${c.exampleQuote}”`}
                          </Text>
                        ) : null}
                      </BlockStack>
                    ))}
                  </BlockStack>
                ) : (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Add customer questions to detect competitor risk.
                  </Text>
                )}
              </Card>
            </BlockStack>

            <BlockStack gap="300">
              <SectionHeader
                title="Recommended Actions"
                description="Quick wins and high-demand questions to address first"
              />
              <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">
                      Quick wins
                    </Text>
                    {revenue.quickWins.length > 0 ? (
                      revenue.quickWins.slice(0, 6).map((w, index) => (
                        <BlockStack key={`${w.title}-${index}`} gap="100">
                          {index > 0 ? <Divider /> : null}
                          <InlineStack align="space-between" blockAlign="center" wrap={false} gap="200">
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              {w.title}
                            </Text>
                            <PriorityBadge level={IMPACT_LEVEL[w.impact] ?? "low"} />
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {w.action}
                          </Text>
                        </BlockStack>
                      ))
                    ) : (
                      <Text as="p" variant="bodySm" tone="subdued">
                        No recovery actions yet.
                      </Text>
                    )}
                  </BlockStack>
                </Card>
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">
                      Question opportunities
                    </Text>
                    {insight.questionOpportunities.length > 0 ? (
                      insight.questionOpportunities.slice(0, 6).map((q, index) => (
                        <BlockStack key={`${q.groupId}-${index}`} gap="100">
                          {index > 0 ? <Divider /> : null}
                          <InlineStack align="space-between" blockAlign="center" wrap={false} gap="200">
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              {q.label}
                            </Text>
                            <PriorityBadge level={IMPACT_LEVEL[q.severity] ?? "low"} />
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {q.suggestedAction}
                          </Text>
                          <InlineStack gap="300" blockAlign="center">
                            <Text as="span" variant="bodySm" tone="subdued">
                              {`${formatNumber(q.count)} mentions · ${money(q.revenueImpact)} at risk`}
                            </Text>
                            <TrendIndicator value={q.trend7} suffix="7d" />
                          </InlineStack>
                        </BlockStack>
                      ))
                    ) : (
                      <Text as="p" variant="bodySm" tone="subdued">
                        Ready to analyze customer questions.
                      </Text>
                    )}
                  </BlockStack>
                </Card>
              </InlineGrid>
            </BlockStack>
          </>
        )}

        <BlockStack gap="300">
          <SectionHeader
            title="Executive Summary Exports"
            description="Forward-ready summaries for operators, marketers, and leadership"
          />
          <Card>
            {reports.length > 0 ? (
              <DataTable
                columnContentTypes={["text", "numeric", "text", "text"]}
                headings={["Generated", "Score", "Provider", "Export"]}
                rows={reports.map((report) => [
                  new Date(report.generatedAt).toLocaleDateString(),
                  report.insightScore,
                  report.aiProvider && !["mock", "rule"].includes(report.aiProvider)
                    ? report.aiProvider
                    : "Rule-based",
                  canExport ? (
                    <InlineStack gap="100" key={report.id}>
                      {["pdf", "html", "email-html"].map((format) => (
                        <Form method="post" key={format}>
                          <input type="hidden" name="intent" value="export" />
                          <input type="hidden" name="id" value={report.id} />
                          <input type="hidden" name="format" value={format} />
                          <Button submit size="slim">
                            {format === "email-html" ? "EMAIL" : format.toUpperCase()}
                          </Button>
                        </Form>
                      ))}
                    </InlineStack>
                  ) : (
                    <Badge key={report.id} tone="info">
                      Pro only
                    </Badge>
                  ),
                ])}
              />
            ) : (
              <Box padding="200">
                <Text as="p" variant="bodySm" tone="subdued">
                  Generate a weekly summary after running analysis.
                </Text>
              </Box>
            )}
          </Card>
        </BlockStack>

        <StickyActionBar align="space-between">
          <Text as="span" variant="bodySm" tone="subdued">
            {hasRun ? "Latest analysis ready to summarize" : "Import data to enable weekly summaries"}
          </Text>
          <InlineStack gap="200">
            {canExport && latest ? (
              <Form method="post">
                <input type="hidden" name="intent" value="export" />
                <input type="hidden" name="id" value={latest.id} />
                <input type="hidden" name="format" value="html" />
                <Button submit>Generate HTML report</Button>
              </Form>
            ) : null}
            <Form method="post">
              <input type="hidden" name="intent" value="summary" />
              <Button submit variant="primary" disabled={!hasRun}>
                Generate weekly summary
              </Button>
            </Form>
          </InlineStack>
        </StickyActionBar>
      </BlockStack>
    </AppPage>
  );
}
