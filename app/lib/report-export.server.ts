import type { InsightResult } from "~/lib/types";
import { normalizeInsightResult } from "~/lib/types";

export type ReportPeriod = "weekly" | "monthly" | "quarterly";

export interface ROIEstimate {
  publishedPages: number;
  publishedBlogs: number;
  publishedFaqs: number;
  estimatedConversionLift: number; // percentage points
  estimatedMonthlyRecovery: number; // USD
  estimatedAnnualRecovery: number;
  roiMultiple: number;
  methodology: string;
}

// Estimates ROI based on published content counts and the insight's revenue opportunity.
// Uses conservative conversion lift assumptions.
export function buildROIEstimate(
  insight: InsightResult,
  published: { pages: number; blogs: number; productFaqs: number },
): ROIEstimate {
  const safe = normalizeInsightResult(insight);
  const totalPublished = published.pages + published.blogs + published.productFaqs;
  // Each published piece of content addresses a buying objection.
  // Conservative: each piece lifts conversion 0.3% for pages, 0.2% for blogs.
  const conversionLift =
    published.pages * 0.3 + published.blogs * 0.2 + published.productFaqs * 0.15;
  const baseMonthly = safe.revenueOpportunity.estimatedHigh;
  const estimatedMonthlyRecovery = Math.round(baseMonthly * (conversionLift / 100));
  const estimatedAnnualRecovery = estimatedMonthlyRecovery * 12;
  // ROI multiple: recovery vs assumed content creation time cost ($50/hr * 0.5hr per piece).
  const contentCost = Math.max(1, totalPublished * 25);
  const roiMultiple = estimatedAnnualRecovery > 0 ? Math.round(estimatedAnnualRecovery / contentCost) : 0;

  return {
    publishedPages: published.pages,
    publishedBlogs: published.blogs,
    publishedFaqs: published.productFaqs,
    estimatedConversionLift: Math.round(conversionLift * 10) / 10,
    estimatedMonthlyRecovery,
    estimatedAnnualRecovery,
    roiMultiple,
    methodology:
      "Conservative estimate: 0.3% conversion lift per published FAQ page, 0.2% per blog article, 0.15% per product FAQ. Applied to revenue opportunity from latest analysis.",
  };
}

export function buildMonthlyReport(input: {
  shopDomain: string;
  insight: InsightResult;
  monthStart: string;
  monthEnd: string;
  published?: { pages: number; blogs: number; productFaqs: number };
}): string {
  const { shopDomain, insight, monthStart, monthEnd, published } = input;
  const safe = normalizeInsightResult(insight);
  const roi = published ? buildROIEstimate(insight, published) : null;

  return [
    "# Monthly Revenue Recovery Report",
    "",
    `Shop: ${shopDomain}`,
    `Period: ${monthStart} to ${monthEnd}`,
    `Insight score: ${safe.insightScore}/100`,
    `Revenue at risk: ${safe.revenueOpportunity.headline}`,
    "",
    "## Executive Summary",
    `- ${safe.storewideOpportunities.length} storewide buying objections detected`,
    `- ${safe.contentGaps.length} product content gaps identified`,
    `- ${safe.competitors.length} competitor(s) mentioned by customers`,
    `- ${safe.messageCount} customer questions analyzed`,
    "",
    "## Storewide Gaps",
    ...safe.storewideOpportunities.slice(0, 8).map(
      (item) => `- ${item.label}: ${item.mentionCount} mentions (${item.severity} severity)`,
    ),
    "",
    "## Product Gaps",
    ...safe.contentGaps.slice(0, 8).map(
      (item) => `- ${item.productTitle}: missing ${item.missingSections.join(", ")}`,
    ),
    "",
    "## Competitor Threats",
    safe.competitors.length > 0
      ? safe.competitors.slice(0, 5).map((c) => `- ${c.name}: ${c.count} mentions`).join("\n")
      : "- No competitor brands detected this period.",
    "",
    "## Recovery Actions",
    ...safe.revenueOpportunity.quickWins.slice(0, 5).map((w) => `- ${w.title}: ${w.action}`),
    "",
    ...(roi
      ? [
          "## Published Assets ROI",
          `- Pages published: ${roi.publishedPages}`,
          `- Blog articles: ${roi.publishedBlogs}`,
          `- Product FAQs: ${roi.publishedFaqs}`,
          `- Estimated conversion lift: ${roi.estimatedConversionLift}%`,
          `- Est. monthly recovery: $${roi.estimatedMonthlyRecovery}`,
          `- Est. annual recovery: $${roi.estimatedAnnualRecovery}`,
          `- ROI multiple: ${roi.roiMultiple}x`,
          "",
        ]
      : []),
  ].join("\n");
}

export function buildQuarterlyReport(input: {
  shopDomain: string;
  insight: InsightResult;
  quarterStart: string;
  quarterEnd: string;
  published?: { pages: number; blogs: number; productFaqs: number };
}): string {
  const { shopDomain, insight, quarterStart, quarterEnd, published } = input;
  const safe = normalizeInsightResult(insight);
  const roi = published ? buildROIEstimate(insight, published) : null;

  const topFriction = safe.questionOpportunities
    .slice(0, 5)
    .map((q) => `- ${q.label}: ${q.count} mentions, ${q.severity} severity, ${q.suggestedAction}`)
    .join("\n");

  return [
    "# Quarterly Executive Revenue Recovery Report",
    "",
    `Shop: ${shopDomain}`,
    `Quarter: ${quarterStart} to ${quarterEnd}`,
    `Recovery score: ${safe.insightScore}/100`,
    "",
    "## Executive Summary",
    `Revenue at risk: ${safe.revenueOpportunity.headline}`,
    `Top friction: ${safe.revenueOpportunity.topFriction?.label ?? "Not yet analyzed"}`,
    `Storewide opportunities: ${safe.storewideOpportunities.length}`,
    `Product opportunities: ${safe.contentGaps.length + safe.productConfusion.length}`,
    `Competitor threats: ${safe.competitors.length}`,
    `Total messages analyzed: ${safe.messageCount}`,
    "",
    "## Top Buying Friction",
    topFriction || "- No friction themes detected. Import customer conversations to unlock insights.",
    "",
    "## Storewide Opportunities",
    ...safe.storewideOpportunities
      .slice(0, 10)
      .map((item) => `- [${item.severity.toUpperCase()}] ${item.label}: ${item.mentionCount} mentions — ${item.suggestedAction}`),
    "",
    "## Product Opportunities",
    ...safe.contentGaps
      .slice(0, 8)
      .map((item) => `- ${item.productTitle}: ${item.missingSections.join(", ")} (score ${item.contentGapScore}/100)`),
    "",
    "## Competitor Analysis",
    safe.competitors.length > 0
      ? safe.competitors
          .slice(0, 8)
          .map((c) => `- ${c.name}: ${c.count} mentions${c.exampleQuote ? ` — "${c.exampleQuote}"` : ""}`)
          .join("\n")
      : "- No competitor brand mentions detected.",
    "",
    "## Recommended Q-Actions",
    ...safe.revenueOpportunity.quickWins.slice(0, 8).map((w) => `- ${w.title} (${w.impact} impact): ${w.action}`),
    "",
    ...(roi
      ? [
          "## Published Assets & ROI",
          `- Content published: ${roi.publishedPages + roi.publishedBlogs + roi.publishedFaqs} pieces`,
          `  - FAQ pages: ${roi.publishedPages}`,
          `  - Blog articles: ${roi.publishedBlogs}`,
          `  - Product FAQs: ${roi.publishedFaqs}`,
          `- Estimated conversion lift: ${roi.estimatedConversionLift}%`,
          `- Est. monthly recovery: $${roi.estimatedMonthlyRecovery}`,
          `- Est. annual recovery: $${roi.estimatedAnnualRecovery}`,
          `- ROI multiple: ${roi.roiMultiple}x`,
          `- Methodology: ${roi.methodology}`,
          "",
        ]
      : []),
  ].join("\n");
}

export function buildExecutiveSummary(insight: InsightResult): string {
  const safe = normalizeInsightResult(insight);
  return [
    `Recovery score: ${safe.insightScore}/100`,
    `Revenue at risk: ${safe.revenueOpportunity.headline}`,
    `Top friction: ${safe.revenueOpportunity.topFriction?.label ?? "Add customer questions to unlock"}`,
    `Storewide opportunities: ${safe.storewideOpportunities.length}`,
    `Product gaps: ${safe.contentGaps.length}`,
    `Competitor threats: ${safe.competitors.length}`,
  ].join("\n");
}

export function buildExecutiveReport(input: {
  shopDomain: string;
  insight: InsightResult;
  weekStart: string;
  weekEnd: string;
}): string {
  const { shopDomain, insight, weekStart, weekEnd } = input;
  const safeInsight = normalizeInsightResult(insight);
  return [
    "# Weekly Executive Report",
    "",
    `Shop: ${shopDomain}`,
    `Period: ${weekStart} to ${weekEnd}`,
    `Estimated opportunity: ${safeInsight.revenueOpportunity.headline}`,
    `Insight score: ${safeInsight.insightScore}/100`,
    "",
    "## Top customer questions",
    ...safeInsight.topQuestions.slice(0, 5).map((item) => `- ${item.text}: ${item.count} customers asked`),
    "",
    "## Biggest friction",
    ...safeInsight.questionOpportunities.slice(0, 5).map((item) => `- ${item.label}: ${item.suggestedAction} (${item.severity})`),
    "",
    "## Storewide opportunities",
    ...(safeInsight.storewideOpportunities.length
      ? safeInsight.storewideOpportunities.slice(0, 5).map((item) => `- ${item.code}: ${item.label}, ${item.mentionCount} mentions`)
      : ["- No storewide opportunities detected."]),
    "",
    "## Competitor mentions",
    ...(safeInsight.competitors.length
      ? safeInsight.competitors.slice(0, 5).map((item) => `- ${item.name}: ${item.count} mentions`)
      : ["- Import more customer conversations to track competitor risk."]),
    "",
    "## Product opportunities",
    ...(safeInsight.contentGaps.length
      ? safeInsight.contentGaps.slice(0, 5).map((item) => `- ${item.productTitle}: ${item.missingSections.join(", ")}`)
      : safeInsight.productConfusion.length
        ? safeInsight.productConfusion.slice(0, 5).map((item) => `- ${item.productTitle}: score ${item.confusionScore}`)
        : ["- No product-specific opportunities detected."]),
    "",
    "## Suggested actions",
    ...safeInsight.revenueOpportunity.quickWins.map((item) => `- ${item.title}: ${item.action}`),
  ].join("\n");
}

export function buildExecutiveHtmlReport(input: {
  shopDomain: string;
  insight: InsightResult;
  weekStart: string;
  weekEnd: string;
}): string {
  const markdown = buildExecutiveReport(input);
  const body = markdown
    .split("\n")
    .map((line) => {
      if (line.startsWith("# ")) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
      if (line.startsWith("## ")) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
      if (line.startsWith("- ")) return `<li>${escapeHtml(line.slice(2))}</li>`;
      if (!line.trim()) return "";
      return `<p>${escapeHtml(line)}</p>`;
    })
    .join("\n");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    "<title>Weekly Executive Report</title>",
    "<style>body{font-family:Arial,sans-serif;max-width:760px;margin:0 auto;padding:32px;color:#202223}h1{font-size:28px}h2{font-size:18px;margin-top:28px}li{margin:6px 0}.cta{background:#008060;color:white;padding:12px 16px;border-radius:6px;display:inline-block;text-decoration:none}</style>",
    "</head>",
    "<body>",
    body,
    '<p><a class="cta" href="/app">Review revenue recovery actions</a></p>',
    "</body>",
    "</html>",
  ].join("\n");
}

export function buildWeeklyEmailHtml(input: {
  shopDomain: string;
  insight: InsightResult;
  weekStart: string;
  weekEnd: string;
}): string {
  const safeInsight = normalizeInsightResult(input.insight);
  return [
    "<!doctype html>",
    '<html lang="en"><body style="font-family:Arial,sans-serif;color:#202223">',
    `<h1>Weekly revenue recovery summary</h1>`,
    `<p>${escapeHtml(input.shopDomain)} · ${escapeHtml(input.weekStart)} to ${escapeHtml(input.weekEnd)}</p>`,
    `<h2>${escapeHtml(safeInsight.revenueOpportunity.headline)}</h2>`,
    "<h3>Top actions</h3>",
    "<ul>",
    ...safeInsight.recommendedActions.slice(0, 5).map(
      (action) => `<li><strong>${escapeHtml(action.title)}</strong> — ${escapeHtml(action.recommendedAction)}</li>`,
    ),
    "</ul>",
    "<h3>Storewide opportunities</h3>",
    "<ul>",
    ...safeInsight.storewideOpportunities.slice(0, 5).map(
      (item) => `<li>${escapeHtml(item.label)}: ${item.mentionCount} mentions</li>`,
    ),
    "</ul>",
    "<h3>Product opportunities</h3>",
    "<ul>",
    ...safeInsight.contentGaps.slice(0, 5).map(
      (product) => `<li>${escapeHtml(product.productTitle)}: ${escapeHtml(product.missingSections.join(", "))}</li>`,
    ),
    "</ul>",
    "</body></html>",
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildReportCsv(insight: InsightResult): string {
  const safeInsight = normalizeInsightResult(insight);
  const rows = [
    ["section", "name", "count", "impact", "action"],
    ...safeInsight.questionOpportunities.map((item) => [
      "question_opportunity",
      item.label,
      String(item.count),
      String(item.revenueImpact),
      item.suggestedAction,
    ]),
    ...safeInsight.storewideOpportunities.map((item) => [
      "storewide_opportunity",
      item.code,
      String(item.mentionCount),
      String(item.highEstimate),
      item.suggestedAction,
    ]),
    ...safeInsight.competitors.map((item) => [
      "competitor",
      item.name,
      String(item.count),
      "",
      item.exampleQuote ?? "",
    ]),
    ...safeInsight.productConfusion.map((item) => [
      "product_confusion",
      item.productTitle,
      String(item.mentionCount),
      String(item.confusionScore),
      item.topGroups.join("|"),
    ]),
    ...safeInsight.contentGaps.map((item) => [
      "product_opportunity",
      item.productTitle,
      String(item.mentionCount),
      String(item.contentGapScore),
      item.missingSections.join("|"),
    ]),
  ];
  return rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
}

export function buildSimplePdf(text: string): Uint8Array {
  const safe = text
    .replace(/[()\\]/g, "\\$&")
    .split("\n")
    .slice(0, 42);
  const content = [
    "BT",
    "/F1 11 Tf",
    "40 770 Td",
    ...safe.flatMap((line, index) => [
      index === 0 ? "" : "0 -16 Td",
      `(${line.slice(0, 92)}) Tj`,
    ]),
    "ET",
  ].filter(Boolean).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}
