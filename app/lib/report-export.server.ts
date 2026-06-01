import type { InsightResult } from "~/lib/types";
import { normalizeInsightResult } from "~/lib/types";

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
    "## Competitor mentions",
    ...(safeInsight.competitors.length
      ? safeInsight.competitors.slice(0, 5).map((item) => `- ${item.name}: ${item.count} mentions`)
      : ["- Import more customer conversations to track competitor risk."]),
    "",
    "## Product confusion",
    ...(safeInsight.productConfusion.length
      ? safeInsight.productConfusion.slice(0, 5).map((item) => `- ${item.productTitle}: score ${item.confusionScore}`)
      : ["- Sync product and order data and run analysis to identify products at risk."]),
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
    "<h3>Products at risk</h3>",
    "<ul>",
    ...safeInsight.productConfusion.slice(0, 5).map(
      (product) => `<li>${escapeHtml(product.productTitle)}: score ${product.confusionScore}/100</li>`,
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
