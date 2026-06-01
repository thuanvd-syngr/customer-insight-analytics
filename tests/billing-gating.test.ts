import { describe, expect, it } from "vitest";

import {
  canExportReport,
  canGenerateAISummary,
  getDevPlanOverride,
  isBillingTestMode,
  canImportMessages,
  canRunAnalysis,
  resolvePlan,
} from "~/lib/billing";

describe("billing gating", () => {
  it("gates message import", () => {
    expect(canImportMessages({ plan: "free", messagesThisMonth: 90, analysesThisWeek: 0, aiSummariesThisMonth: 0 }, 10).allowed).toBe(true);
    expect(canImportMessages({ plan: "free", messagesThisMonth: 91, analysesThisWeek: 0, aiSummariesThisMonth: 0 }, 10).allowed).toBe(false);
  });

  it("gates analysis runs", () => {
    expect(canRunAnalysis({ plan: "free", messagesThisMonth: 0, analysesThisWeek: 0, aiSummariesThisMonth: 0 }).allowed).toBe(true);
    expect(canRunAnalysis({ plan: "free", messagesThisMonth: 0, analysesThisWeek: 1, aiSummariesThisMonth: 0 }).allowed).toBe(false);
  });

  it("gates plan features", () => {
    expect(canGenerateAISummary({ plan: "growth", messagesThisMonth: 0, analysesThisWeek: 0, aiSummariesThisMonth: 0 }).allowed).toBe(true);
    expect(canGenerateAISummary({ plan: "starter", messagesThisMonth: 0, analysesThisWeek: 0, aiSummariesThisMonth: 0 }).allowed).toBe(false);
    expect(canExportReport("pro").allowed).toBe(true);
    expect(canExportReport("growth").allowed).toBe(false);
  });

  it("resolves dev overrides only outside production", () => {
    expect(resolvePlan({ activePlanId: "free", devOverride: "pro", devOverrideEnabled: true, isProduction: false })).toBe("pro");
    expect(resolvePlan({ activePlanId: "free", devOverride: "pro", devOverrideEnabled: false, isProduction: false })).toBe("free");
    expect(resolvePlan({ activePlanId: "free", devOverride: "pro", devOverrideEnabled: true, isProduction: true })).toBe("free");
  });

  it("hides production dev override and reads billing test env", () => {
    expect(getDevPlanOverride({
      NODE_ENV: "development",
      ENABLE_DEV_PLAN_OVERRIDE: "true",
      DEV_PLAN_OVERRIDE: "pro",
    } as NodeJS.ProcessEnv)).toBe("pro");
    expect(getDevPlanOverride({
      NODE_ENV: "production",
      ENABLE_DEV_PLAN_OVERRIDE: "true",
      DEV_PLAN_OVERRIDE: "pro",
    } as NodeJS.ProcessEnv)).toBeNull();
    expect(getDevPlanOverride({
      NODE_ENV: "development",
      ENABLE_DEV_PLAN_OVERRIDE: "false",
      DEV_PLAN_OVERRIDE: "pro",
    } as NodeJS.ProcessEnv)).toBeNull();
    expect(isBillingTestMode({ NODE_ENV: "production", SHOPIFY_BILLING_TEST: "true" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isBillingTestMode({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(false);
  });
});
