import { describe, expect, it } from "vitest";

import { MockEmailProvider } from "~/lib/email/mock-provider";
import {
  buildWeeklyReportEmail,
  buildMonthlyReportEmail,
  buildAlertEmail,
  getEmailSubject,
} from "~/lib/email/report-email";
import { EMPTY_INSIGHT } from "~/lib/types";
import type { InsightResult } from "~/lib/types";

const MOCK_INSIGHT: Partial<InsightResult> = {
  ...EMPTY_INSIGHT,
  insightScore: 65,
  messageCount: 80,
  storewideOpportunities: [
    {
      code: "STOREWIDE_SHIPPING_GAP",
      groupId: "shipping",
      label: "Shipping FAQ Gap",
      severity: "high",
      mentionCount: 12,
      suggestedAction: "Add shipping FAQ",
      lowEstimate: 100,
      highEstimate: 250,
    } as InsightResult["storewideOpportunities"][0],
  ],
  competitors: [{ name: "Burton", count: 4, exampleQuote: "I'm thinking of switching to Burton" }],
  revenueOpportunity: {
    ...EMPTY_INSIGHT.revenueOpportunity,
    estimatedLow: 200,
    estimatedHigh: 600,
    headline: "Estimated $200–$600/mo at risk.",
    quickWins: [
      {
        groupId: "shipping",
        title: "Add Shipping FAQ",
        action: "Publish a shipping FAQ page",
        impact: "high" as const,
        priorityScore: 80,
        lowEstimate: 100,
        highEstimate: 250,
        ctaLabel: "Create FAQ",
      },
    ],
  } as InsightResult["revenueOpportunity"],
  contentGaps: [
    {
      productId: "gid://shopify/Product/1",
      productTitle: "Test Board",
      mentionCount: 3,
      contentGapScore: 70,
      missingSections: ["Shipping"],
      coveredSections: [],
      customerQuestions: [],
      recommendedActions: ["Add shipping info"],
      estimatedLow: 50,
      estimatedHigh: 120,
    } as InsightResult["contentGaps"][0],
  ],
};

const BASE_EMAIL_INPUT = {
  shopDomain: "test.myshopify.com",
  storeName: "Test Store",
  insight: MOCK_INSIGHT as InsightResult,
  recipientEmail: "owner@test.com",
};

describe("MockEmailProvider", () => {
  it("isConfigured returns true", () => {
    const provider = new MockEmailProvider();
    expect(provider.isConfigured()).toBe(true);
  });

  it("id is 'mock'", () => {
    const provider = new MockEmailProvider();
    expect(provider.id).toBe("mock");
  });

  it("send returns ok:true with a messageId", async () => {
    const provider = new MockEmailProvider();
    const result = await provider.send({
      to: "test@example.com",
      subject: "Test",
      html: "<p>Hello</p>",
    });
    expect(result.ok).toBe(true);
    expect(result.messageId).toBeTruthy();
    expect(result.provider).toBe("mock");
  });

  it("send generates unique message IDs", async () => {
    const provider = new MockEmailProvider();
    const r1 = await provider.send({ to: "a@b.com", subject: "S", html: "<p>H</p>" });
    const r2 = await provider.send({ to: "a@b.com", subject: "S", html: "<p>H</p>" });
    expect(r1.messageId).not.toBe(r2.messageId);
  });
});

describe("buildWeeklyReportEmail", () => {
  it("returns valid HTML string", () => {
    const html = buildWeeklyReportEmail({ ...BASE_EMAIL_INPUT, reportType: "weekly" });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Weekly Revenue Recovery Report");
  });

  it("includes store name", () => {
    const html = buildWeeklyReportEmail({ ...BASE_EMAIL_INPUT, reportType: "weekly" });
    expect(html).toContain("Test Store");
  });

  it("includes top opportunities", () => {
    const html = buildWeeklyReportEmail({ ...BASE_EMAIL_INPUT, reportType: "weekly" });
    expect(html).toContain("Shipping FAQ Gap");
  });

  it("includes competitor mentions section when competitors exist", () => {
    const html = buildWeeklyReportEmail({ ...BASE_EMAIL_INPUT, reportType: "weekly" });
    expect(html).toContain("Burton");
  });

  it("works on empty insight without throwing", () => {
    const html = buildWeeklyReportEmail({ ...BASE_EMAIL_INPUT, reportType: "weekly", insight: EMPTY_INSIGHT as InsightResult });
    expect(html).toContain("Weekly Revenue Recovery Report");
  });
});

describe("buildMonthlyReportEmail", () => {
  it("returns HTML with monthly header", () => {
    const html = buildMonthlyReportEmail({ ...BASE_EMAIL_INPUT, reportType: "monthly" });
    expect(html).toContain("Monthly Revenue Recovery Report");
  });

  it("includes quick wins section", () => {
    const html = buildMonthlyReportEmail({ ...BASE_EMAIL_INPUT, reportType: "monthly" });
    expect(html).toContain("Quick Wins");
  });

  it("includes content gaps section", () => {
    const html = buildMonthlyReportEmail({ ...BASE_EMAIL_INPUT, reportType: "monthly" });
    expect(html).toContain("Products Needing Content");
  });
});

describe("buildAlertEmail", () => {
  it("builds competitor alert", () => {
    const html = buildAlertEmail({ ...BASE_EMAIL_INPUT, reportType: "alert_competitor" });
    expect(html).toContain("Burton");
    expect(html).toContain("Competitor Alert");
  });

  it("builds high-impact alert", () => {
    const html = buildAlertEmail({ ...BASE_EMAIL_INPUT, reportType: "alert_high_impact" });
    expect(html).toContain("High-Impact Opportunity");
  });

  it("builds test alert gracefully", () => {
    const html = buildAlertEmail({ ...BASE_EMAIL_INPUT, reportType: "test" });
    expect(html).toContain("<!DOCTYPE html>");
  });
});

describe("getEmailSubject", () => {
  it("returns correct subjects for each type", () => {
    expect(getEmailSubject("weekly", "My Store")).toBe("Weekly Recovery Report — My Store");
    expect(getEmailSubject("monthly", "My Store")).toBe("Monthly Revenue Report — My Store");
    expect(getEmailSubject("alert_competitor", "My Store")).toBe("Competitor Alert — My Store");
    expect(getEmailSubject("alert_high_impact", "My Store")).toBe("High-Impact Opportunity — My Store");
    expect(getEmailSubject("test", "My Store")).toBe("Test Report — My Store");
  });
});
