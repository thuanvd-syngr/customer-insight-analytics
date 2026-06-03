import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import type { WeeklyEmail, WeeklyReport } from "@prisma/client";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
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
  buildExecutiveSummary,
  buildMonthlyReport,
  buildQuarterlyReport,
  buildROIEstimate,
  buildReportCsv,
  buildSimplePdf,
  buildWeeklyEmailHtml,
} from "~/lib/report-export.server";
import { getPublishedCounts } from "~/lib/publish/shopify-publisher.server";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { normalizeInsightResult } from "~/lib/types";
import { authenticate } from "~/shopify.server";
import { getDelegate } from "~/lib/prisma-safe";

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
  try {
    const { shop, plan } = await context(request);
    const weeklyReport = getDelegate(prisma, "weeklyReport");
    const weeklyEmail = getDelegate(prisma, "weeklyEmail");
    const appSetting = getDelegate(prisma, "appSetting");
    const [reports, weeklyEmails, latestRun, publishedCounts, reportEmailSetting] = await Promise.all([
      weeklyReport?.findMany
        ? weeklyReport.findMany({ where: { shopId: shop.id }, orderBy: { createdAt: "desc" }, take: 10 })
        : [],
      weeklyEmail?.findMany
        ? weeklyEmail.findMany({ where: { shopId: shop.id }, orderBy: { generatedAt: "desc" }, take: 10 })
        : [],
      getLatestRun(prisma, shop.id),
      getPublishedCounts(prisma, shop.id),
      appSetting?.findUnique
        ? appSetting.findUnique({ where: { shopId_key: { shopId: shop.id, key: "reportEmail" } } })
        : Promise.resolve(null),
    ]);
  const hasAnalyzedQuestions = (latestRun?.messageCount ?? 0) > 0;
  const latestInsight = hasAnalyzedQuestions ? parseRun(latestRun) : null;
  const roiEstimate = latestInsight ? buildROIEstimate(latestInsight, publishedCounts) : null;
  return json({
    reports,
    weeklyEmails,
    latestInsight,
    hasRun: hasAnalyzedQuestions,
    plan,
    canExport: canExportReport(plan).allowed,
    publishedCounts,
    roiEstimate,
    reportEmail: (reportEmailSetting as { value?: string } | null)?.value ?? "",
    executiveSummary: latestInsight ? buildExecutiveSummary(latestInsight) : null,
    loadError: null,
  });
  } catch (error) {
    console.error("Reports loader failed", error);
    return json({
      reports: [],
      weeklyEmails: [],
      latestInsight: null,
      hasRun: false,
      plan: "free",
      canExport: false,
      publishedCounts: { total: 0, pages: 0, blogs: 0, productFaqs: 0 },
      roiEstimate: null,
      reportEmail: "",
      executiveSummary: null,
      loadError: "Some data could not be loaded. Your store data is safe. Try refreshing or run analysis again.",
    });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const { shop, plan, shopDomain } = await context(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "export") {
    const gate = canExportReport(plan);
    if (!gate.allowed) return json({ error: gate.reason ?? "Your plan does not include report exports." });
    const id = String(form.get("id") ?? "");
    const format = String(form.get("format") ?? "markdown");
    const weeklyReport = getDelegate(prisma, "weeklyReport");
    const report = weeklyReport?.findFirst
      ? await weeklyReport.findFirst({ where: { id, shopId: shop.id } })
      : null;
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

  if (intent === "preview-weekly-email") {
    const id = String(form.get("id") ?? "");
    const weeklyEmail = getDelegate(prisma, "weeklyEmail");
    const email = weeklyEmail?.findFirst
      ? await weeklyEmail.findFirst({ where: { id, shopId: shop.id } })
      : null;
    if (!email) return json({ error: "Weekly email not found" }, { status: 404 });
    if (weeklyEmail?.update) await weeklyEmail.update({ where: { id: email.id }, data: { status: "previewed" } });
    return new Response(email.html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="${id}-weekly-recovery-email.html"`,
      },
    });
  }

  const now = new Date();
  const run = await getLatestRun(prisma, shop.id);
  const hasAnalyzedQuestions = (run?.messageCount ?? 0) > 0;
  const insight = hasAnalyzedQuestions ? parseRun(run) : null;
  if (!run || !insight) return redirect("/app/import");

  const weekEnd = now.toISOString().slice(0, 10);
  const weekStart = new Date(now.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
  const provider = getAIProvider();
  const useAI = PLANS[plan].features.aiWeeklySummary && provider.isConfigured();
  const input = { shopDomain, insight, weekStart, weekEnd };
  if (intent === "monthly" || intent === "quarterly") {
    const gate = canExportReport(plan);
    if (!gate.allowed) return json({ error: gate.reason ?? "Your plan does not include extended report exports." });
    if (!run || !insight) return redirect("/app/import");
    const now = new Date();
    const periodEnd = now.toISOString().slice(0, 10);
    const periodDays = intent === "monthly" ? 30 : 90;
    const periodStart = new Date(now.getTime() - periodDays * 86_400_000).toISOString().slice(0, 10);
    const published = await getPublishedCounts(prisma, shop.id);
    const reportText = intent === "monthly"
      ? buildMonthlyReport({ shopDomain, insight, monthStart: periodStart, monthEnd: periodEnd, published })
      : buildQuarterlyReport({ shopDomain, insight, quarterStart: periodStart, quarterEnd: periodEnd, published });
    const filename = `${intent}-report-${periodEnd}`;
    const format = String(form.get("format") ?? "markdown");
    if (format === "html") {
      return new Response(buildExecutiveHtmlReport({ shopDomain, insight, weekStart: periodStart, weekEnd: periodEnd }), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}.html"` },
      });
    }
    if (format === "pdf") {
      return new Response(Buffer.from(buildSimplePdf(reportText)), {
        headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}.pdf"` },
      });
    }
    if (format === "csv") {
      return new Response(buildReportCsv(insight), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}.csv"` },
      });
    }
    return new Response(reportText, {
      headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}.md"` },
    });
  }

  if (intent === "weekly-email") {
    const html = buildWeeklyEmailHtml(input);
    const weeklyEmail = getDelegate(prisma, "weeklyEmail");
    if (!weeklyEmail?.create) return redirect("/app/reports");
    await weeklyEmail.create({
      data: {
        shopId: shop.id,
        runId: run.id,
        subject: `Weekly revenue recovery for ${shopDomain}`,
        html,
      },
    });
    return redirect("/app/reports");
  }

  const usage = await getUsageSnapshot(prisma, shop.id, plan, now);
  const gate = canGenerateAISummary(usage);
  if (!gate.allowed) return json({ error: gate.reason ?? "Your plan has reached the weekly summary limit." });
  const aiSummary = useAI
    ? await provider.generateWeeklySummary(input)
    : buildExecutiveReport(input);
  const weeklyReport = getDelegate(prisma, "weeklyReport");
  if (!weeklyReport?.create) return redirect("/app/reports");
  await weeklyReport.create({
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
  const {
    reports,
    weeklyEmails,
    latestInsight,
    hasRun,
    canExport,
    publishedCounts,
    roiEstimate,
    reportEmail,
    executiveSummary,
    loadError,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<{ error?: string }>();
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
  const productGapBars: BarDatum[] = (insight?.contentGaps ?? []).slice(0, 6).map((p) => ({
    label: p.productTitle,
    value: p.contentGapScore,
    display: `${formatNumber(p.mentionCount)} matched questions`,
    tone: p.contentGapScore >= 67 ? "critical" : p.contentGapScore >= 34 ? "warning" : "info",
  }));

  const driverBars: BarDatum[] = (revenue?.drivers ?? []).slice(0, 6).map((d) => ({
    label: d.label,
    value: d.revenueImpact,
    display: money(d.revenueImpact),
    tone: "critical",
  }));
  const storewideBars: BarDatum[] = (insight?.storewideOpportunities ?? []).slice(0, 6).map((item) => ({
    label: item.label,
    value: item.mentionCount,
    display: `${formatNumber(item.mentionCount)} mentions`,
    tone: item.severity === "high" ? "critical" : item.severity === "medium" ? "warning" : "info",
  }));

  return (
    <AppPage
      title="Weekly Revenue Recovery Report"
      subtitle="A weekly operator view of recovered revenue, risk, issues, products, competitors, and actions."
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
        {loadError ? (
          <Card>
            <Text as="p" variant="bodyMd" tone="critical">
              {loadError}
            </Text>
          </Card>
        ) : null}
        {actionData?.error ? (
          <Card>
            <Text as="p" variant="bodyMd" tone="critical">
              {actionData.error}
            </Text>
          </Card>
        ) : null}
        {!hasRun || !insight || !revenue ? (
          <Card>
            <EmptyInsight
              heading="Weekly revenue recovery report will appear here"
              primaryActionLabel="Import conversations"
              primaryActionUrl="/app/import"
              secondaryActionLabel="View dashboard"
              secondaryActionUrl="/app"
            >
              <p>Analyze customer questions to identify lost sales, top issues, products, competitors, and recommended actions.</p>
            </EmptyInsight>
          </Card>
        ) : (
          <>
            <BlockStack gap="300">
              <SectionHeader
              title="Weekly Revenue Recovery Summary"
                description={revenue.headline}
                trailing={
                  revenue.topFriction ? (
                    <TrendIndicator value={revenue.topFriction.trend7} suffix="top issue" />
                  ) : undefined
                }
              />
              <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
                <MetricCard
                  title="Revenue At Risk"
                  value={moneyRange(revenue.estimatedLow, revenue.estimatedHigh)}
                  sublabel={revenue.summary}
                  tone="critical"
                  helpText="Estimated revenue tied to unresolved buying objections across the analysis window."
                />
                <MetricCard
                  title="Revenue Recovered"
                  value="Track after publish"
                  sublabel="Use prepared content to begin measuring recovery"
                  tone="success"
                />
                <MetricCard
                  title="Monthly at Risk"
                  value={money(revenue.monthlyAtRisk)}
                  sublabel="Projected monthly run-rate"
                  tone="warning"
                />
                <MetricCard
                  title="Top Issue"
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
                title="Top Issues"
                description="Buying objections contributing the most estimated revenue impact"
                />
                <Card>
                  <BarChart data={driverBars} tone="critical" />
                </Card>
              </BlockStack>
            ) : null}

            <BlockStack gap="300">
              <SectionHeader
                title="Storewide Opportunities"
                description="General buying objections detected from imported questions"
              />
              <Card>
                {storewideBars.length > 0 ? (
                  <BarChart data={storewideBars} tone="warning" />
                ) : (
                  <Text as="p" variant="bodySm" tone="subdued">
                    No storewide opportunities detected yet.
                  </Text>
                )}
              </Card>
            </BlockStack>

            <BlockStack gap="300">
              <SectionHeader
                title="Product Opportunities"
                description="Product-specific findings from matched customer questions"
              />
              <Card>
                {productGapBars.length > 0 || productBars.length > 0 ? (
                  <BarChart data={productGapBars.length > 0 ? productGapBars : productBars} tone="info" />
                ) : (
                  <Text as="p" variant="bodySm" tone="subdued">
                    No product-specific opportunities yet. Storewide issues can still be actioned above.
                  </Text>
                )}
              </Card>
            </BlockStack>

            <BlockStack gap="300">
              <SectionHeader
                title="Top Competitors"
                description="Competitor concerns surfaced in customer conversations"
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
                description="The highest-priority fixes to recover revenue this week"
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
            title="Weekly Revenue Recovery Email"
            description="Generate, preview, and store HTML email content without sending provider integration."
          />
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="050">
                  <Text as="h3" variant="headingSm">HTML email drafts</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Stored weekly recovery emails can be previewed and copied into any email provider.
                  </Text>
                </BlockStack>
                <Form method="post">
                  <input type="hidden" name="intent" value="weekly-email" />
                  <Button submit variant="primary" disabled={!hasRun}>Generate email HTML</Button>
                </Form>
              </InlineStack>
              {weeklyEmails.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "text", "text"]}
                  headings={["Generated", "Status", "Preview"]}
                  rows={(weeklyEmails as WeeklyEmail[]).map((email) => [
                    new Date(email.generatedAt).toISOString().slice(0, 10),
                    email.status,
                    <Form method="post" key={email.id}>
                      <input type="hidden" name="intent" value="preview-weekly-email" />
                      <input type="hidden" name="id" value={email.id} />
                      <Button submit size="slim">Preview HTML</Button>
                    </Form>,
                  ])}
                />
              ) : (
                <Text as="p" variant="bodySm" tone="subdued">
                  Generate an email after running analysis.
                </Text>
              )}
            </BlockStack>
          </Card>
        </BlockStack>

        <BlockStack gap="300">
          <SectionHeader
            title="Report Preview"
            description="Forward-ready summaries for operators, marketers, and leadership"
          />
          <Card>
            {reports.length > 0 ? (
              <DataTable
                columnContentTypes={["text", "numeric", "text", "text"]}
                headings={["Generated", "Score", "Provider", "Export"]}
                rows={(reports as WeeklyReport[]).map((report) => [
                  new Date(report.generatedAt).toISOString().slice(0, 10),
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

        {roiEstimate && roiEstimate.estimatedMonthlyRecovery > 0 ? (
          <BlockStack gap="300">
            <SectionHeader
              title="Published Assets ROI Estimate"
              description="Conservative estimate of revenue recovery from published content based on conversion lift model."
            />
            <div className="cia-three-grid">
              <Card>
                <BlockStack gap="150">
                  <Text as="p" variant="bodySm" tone="subdued">Est. monthly recovery</Text>
                  <Text as="p" variant="headingLg">{`$${formatNumber(roiEstimate.estimatedMonthlyRecovery)}`}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">{`${roiEstimate.estimatedConversionLift}% conversion lift`}</Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="150">
                  <Text as="p" variant="bodySm" tone="subdued">Est. annual recovery</Text>
                  <Text as="p" variant="headingLg">{`$${formatNumber(roiEstimate.estimatedAnnualRecovery)}`}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">{`${publishedCounts.total} content pieces published`}</Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="150">
                  <Text as="p" variant="bodySm" tone="subdued">ROI multiple</Text>
                  <Text as="p" variant="headingLg">{`${roiEstimate.roiMultiple}x`}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">vs. content creation cost</Text>
                </BlockStack>
              </Card>
            </div>
          </BlockStack>
        ) : null}

        {executiveSummary ? (
          <BlockStack gap="300">
            <SectionHeader
              title="Executive Summary"
              description="Quick-read snapshot for operators and stakeholders."
            />
            <Card>
              <pre style={{ fontFamily: "monospace", fontSize: 13, whiteSpace: "pre-wrap", margin: 0 }}>
                {executiveSummary}
              </pre>
            </Card>
          </BlockStack>
        ) : null}

        <BlockStack gap="300">
          <SectionHeader
            title="Monthly & Quarterly Reports"
            description="Extended period reports with published asset ROI and full opportunity breakdown."
          />
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Generate extended reports</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Monthly and quarterly reports include storewide gaps, product gaps, competitor threats, recovery actions, and published content ROI.
              </Text>
              {canExport && hasRun ? (
                <InlineStack gap="200" wrap>
                  {(["markdown", "html", "pdf", "csv"] as const).map((fmt) => (
                    <Form method="post" key={`monthly-${fmt}`}>
                      <input type="hidden" name="intent" value="monthly" />
                      <input type="hidden" name="format" value={fmt} />
                      <Button submit size="slim">{`Monthly ${fmt.toUpperCase()}`}</Button>
                    </Form>
                  ))}
                </InlineStack>
              ) : null}
              {canExport && hasRun ? (
                <InlineStack gap="200" wrap>
                  {(["markdown", "html", "pdf", "csv"] as const).map((fmt) => (
                    <Form method="post" key={`quarterly-${fmt}`}>
                      <input type="hidden" name="intent" value="quarterly" />
                      <input type="hidden" name="format" value={fmt} />
                      <Button submit size="slim">{`Quarterly ${fmt.toUpperCase()}`}</Button>
                    </Form>
                  ))}
                </InlineStack>
              ) : null}
              {!canExport ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  Monthly and quarterly report export is available on Pro plan.
                </Text>
              ) : null}
              {!hasRun ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  Run analysis to enable extended reports.
                </Text>
              ) : null}
              {reportEmail ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  {`Report email: ${reportEmail} — copy exported HTML into your email provider.`}
                </Text>
              ) : (
                <Text as="p" variant="bodySm" tone="subdued">
                  Set a report email in Settings to include it in report exports.
                </Text>
              )}
            </BlockStack>
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
