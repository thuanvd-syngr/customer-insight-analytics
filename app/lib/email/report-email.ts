// Builds HTML email bodies for weekly, monthly, and alert reports.
// Pure functions — no Prisma, no Shopify API.

import type { InsightResult } from "~/lib/types";
import type { EmailReportType } from "./types";

export interface EmailBuildInput {
  shopDomain: string;
  storeName?: string;
  insight: InsightResult;
  reportType: EmailReportType;
  recipientEmail: string;
}

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function emailWrap(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f9fafb; margin: 0; padding: 24px; color: #111; }
    .wrap { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
    h1 { font-size: 22px; font-weight: 700; margin: 0 0 8px; }
    h2 { font-size: 16px; font-weight: 600; margin: 24px 0 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
    p { font-size: 14px; line-height: 1.6; margin: 4px 0 12px; color: #374151; }
    .kpi { display: inline-block; padding: 12px 18px; border-radius: 8px; background: #f3f4f6; margin: 4px 4px 4px 0; }
    .kpi-val { font-size: 22px; font-weight: 700; }
    .kpi-lbl { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; }
    ul { padding-left: 20px; margin: 8px 0 16px; }
    li { font-size: 14px; line-height: 1.6; color: #374151; margin-bottom: 4px; }
    .footer { font-size: 12px; color: #9ca3af; margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 16px; }
    a { color: #6366f1; }
  </style>
</head>
<body>
  <div class="wrap">
    ${body}
    <div class="footer">
      <p>Sent by Customer Insight Analytics &mdash; <a href="https://${escHtml("app.example.com")}/app/settings">Unsubscribe or manage preferences</a></p>
    </div>
  </div>
</body>
</html>`;
}

export function buildWeeklyReportEmail(input: EmailBuildInput): string {
  const { shopDomain, insight } = input;
  const store = input.storeName ?? shopDomain.replace(".myshopify.com", "");
  const rev = insight.revenueOpportunity;
  const topOpps = insight.storewideOpportunities.slice(0, 3);

  const body = `
    <h1>Weekly Revenue Recovery Report</h1>
    <p>Store: <strong>${escHtml(store)}</strong></p>

    <div>
      <div class="kpi"><div class="kpi-val">${insight.insightScore}</div><div class="kpi-lbl">Recovery Score</div></div>
      <div class="kpi"><div class="kpi-val">${insight.messageCount}</div><div class="kpi-lbl">Messages Analysed</div></div>
      <div class="kpi"><div class="kpi-val">$${rev.estimatedLow}–$${rev.estimatedHigh}</div><div class="kpi-lbl">Revenue at Risk /mo</div></div>
    </div>

    ${topOpps.length > 0 ? `
    <h2>Top Opportunities This Week</h2>
    <ul>
      ${topOpps.map((o) => `<li><strong>${escHtml(o.label)}</strong> — ${escHtml(o.suggestedAction)} (Est. $${o.lowEstimate}–$${o.highEstimate}/mo)</li>`).join("")}
    </ul>` : ""}

    ${insight.competitors.length > 0 ? `
    <h2>Competitor Mentions</h2>
    <ul>
      ${insight.competitors.slice(0, 3).map((c) => `<li>${escHtml(c.name)}: ${c.count} mention${c.count === 1 ? "" : "s"}</li>`).join("")}
    </ul>` : ""}

    <p><a href="https://${escHtml(shopDomain)}/admin/apps">View full dashboard →</a></p>
  `;

  return emailWrap(`Weekly Report — ${store}`, body);
}

export function buildMonthlyReportEmail(input: EmailBuildInput): string {
  const { shopDomain, insight } = input;
  const store = input.storeName ?? shopDomain.replace(".myshopify.com", "");
  const rev = insight.revenueOpportunity;

  const body = `
    <h1>Monthly Revenue Recovery Report</h1>
    <p>Store: <strong>${escHtml(store)}</strong></p>

    <div>
      <div class="kpi"><div class="kpi-val">${insight.insightScore}</div><div class="kpi-lbl">Recovery Score</div></div>
      <div class="kpi"><div class="kpi-val">${insight.messageCount}</div><div class="kpi-lbl">Messages Analysed</div></div>
      <div class="kpi"><div class="kpi-val">$${rev.estimatedLow}–$${rev.estimatedHigh}</div><div class="kpi-lbl">Revenue at Risk /mo</div></div>
      <div class="kpi"><div class="kpi-val">${insight.storewideOpportunities.length}</div><div class="kpi-lbl">Open Opportunities</div></div>
    </div>

    ${rev.quickWins.length > 0 ? `
    <h2>Quick Wins This Month</h2>
    <ul>
      ${rev.quickWins.slice(0, 5).map((w) => `<li><strong>${escHtml(w.title)}</strong>: ${escHtml(w.action)} (Est. $${w.lowEstimate}–$${w.highEstimate}/mo)</li>`).join("")}
    </ul>` : ""}

    ${insight.contentGaps.length > 0 ? `
    <h2>Products Needing Content</h2>
    <ul>
      ${insight.contentGaps.slice(0, 3).map((g) => `<li>${escHtml(g.productTitle)}: ${g.missingSections.join(", ")}</li>`).join("")}
    </ul>` : ""}

    <p><a href="https://${escHtml(shopDomain)}/admin/apps">View full dashboard →</a></p>
  `;

  return emailWrap(`Monthly Report — ${store}`, body);
}

export function buildAlertEmail(input: EmailBuildInput): string {
  const { shopDomain, insight, reportType } = input;
  const store = input.storeName ?? shopDomain.replace(".myshopify.com", "");

  let title = "Recovery Alert";
  let alertBody = "";

  if (reportType === "alert_competitor") {
    const top = insight.competitors[0];
    title = top ? `Competitor Alert: ${top.name}` : "New Competitor Activity";
    alertBody = top
      ? `<p><strong>${escHtml(top.name)}</strong> has been mentioned ${top.count} time${top.count === 1 ? "" : "s"} by your customers. Consider generating comparison content to address buyer questions.</p>`
      : `<p>Competitor activity detected. Review your competitor dashboard for details.</p>`;
  } else if (reportType === "alert_high_impact") {
    const topOpp = insight.storewideOpportunities.find((o) => o.severity === "high");
    title = "High-Impact Opportunity Detected";
    alertBody = topOpp
      ? `<p>A high-impact opportunity has been identified: <strong>${escHtml(topOpp.label)}</strong>.<br>Estimated recovery: $${topOpp.lowEstimate}–$${topOpp.highEstimate}/mo.<br>Suggested action: ${escHtml(topOpp.suggestedAction)}</p>`
      : `<p>New high-impact opportunities are available in your dashboard.</p>`;
  } else {
    alertBody = `<p>There is new activity in your Customer Insight Analytics dashboard that requires your attention.</p>`;
  }

  const body = `
    <h1>${escHtml(title)}</h1>
    <p>Store: <strong>${escHtml(store)}</strong></p>
    ${alertBody}
    <p><a href="https://${escHtml(shopDomain)}/admin/apps">View dashboard →</a></p>
  `;

  return emailWrap(title, body);
}

export function getEmailSubject(reportType: EmailReportType, storeName: string): string {
  const labels: Record<EmailReportType, string> = {
    weekly: `Weekly Recovery Report — ${storeName}`,
    monthly: `Monthly Revenue Report — ${storeName}`,
    quarterly: `Quarterly Executive Report — ${storeName}`,
    alert_competitor: `Competitor Alert — ${storeName}`,
    alert_high_impact: `High-Impact Opportunity — ${storeName}`,
    test: `Test Report — ${storeName}`,
  };
  return labels[reportType] ?? `Report — ${storeName}`;
}
