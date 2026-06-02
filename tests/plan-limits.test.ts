import { describe, expect, it } from "vitest";

import {
  PLAN_EXTENDED_LIMITS,
  canUseBulkActions,
  canUseProductFaqWidget,
  canUseAIProductOptimize,
  canUseEmailReports,
  canUseExecutiveReports,
  canUseAutoPublish,
  canFeature,
  getContentDraftLimit,
  getOpportunityLimit,
} from "~/lib/billing/plan-limits";

describe("PLAN_EXTENDED_LIMITS", () => {
  it("free plan has restrictive limits", () => {
    const free = PLAN_EXTENDED_LIMITS["free"];
    expect(free.contentDrafts).toBe(3);
    expect(free.productFaqWidget).toBe(false);
    expect(free.bulkActions).toBe(false);
    expect(free.emailReports).toBe(false);
    expect(free.executiveReports).toBe(false);
  });

  it("pro plan has permissive limits", () => {
    const pro = PLAN_EXTENDED_LIMITS["pro"];
    expect(pro.bulkActions).toBe(true);
    expect(pro.productFaqWidget).toBe(true);
    expect(pro.aiProductOptimize).toBe(true);
    expect(pro.emailReports).toBe(true);
    expect(pro.executiveReports).toBe(true);
    expect(pro.autoPublish).toBe(true);
  });

  it("growth plan unlocks widget and AI optimize", () => {
    const growth = PLAN_EXTENDED_LIMITS["growth"];
    expect(growth.productFaqWidget).toBe(true);
    expect(growth.aiProductOptimize).toBe(true);
    expect(growth.bulkActions).toBe(false);
  });

  it("starter plan has more drafts than free", () => {
    expect(PLAN_EXTENDED_LIMITS["starter"].contentDrafts).toBeGreaterThan(PLAN_EXTENDED_LIMITS["free"].contentDrafts);
  });
});

describe("canUseProductFaqWidget", () => {
  it("denies free and starter", () => {
    expect(canUseProductFaqWidget("free").allowed).toBe(false);
    expect(canUseProductFaqWidget("starter").allowed).toBe(false);
  });

  it("allows growth and pro", () => {
    expect(canUseProductFaqWidget("growth").allowed).toBe(true);
    expect(canUseProductFaqWidget("pro").allowed).toBe(true);
  });

  it("returns reason when denied", () => {
    expect(canUseProductFaqWidget("free").reason).toBeTruthy();
  });
});

describe("canUseBulkActions", () => {
  it("denies free, starter, and growth", () => {
    expect(canUseBulkActions("free").allowed).toBe(false);
    expect(canUseBulkActions("starter").allowed).toBe(false);
  });

  it("allows pro", () => {
    expect(canUseBulkActions("pro").allowed).toBe(true);
  });
});

describe("canUseAIProductOptimize", () => {
  it("denies free and starter", () => {
    expect(canUseAIProductOptimize("free").allowed).toBe(false);
    expect(canUseAIProductOptimize("starter").allowed).toBe(false);
  });

  it("allows growth and pro", () => {
    expect(canUseAIProductOptimize("growth").allowed).toBe(true);
    expect(canUseAIProductOptimize("pro").allowed).toBe(true);
  });
});

describe("canUseEmailReports", () => {
  it("denies free and starter", () => {
    expect(canUseEmailReports("free").allowed).toBe(false);
  });

  it("allows growth and pro", () => {
    expect(canUseEmailReports("growth").allowed).toBe(true);
    expect(canUseEmailReports("pro").allowed).toBe(true);
  });
});

describe("canUseExecutiveReports", () => {
  it("denies free, starter, and growth", () => {
    expect(canUseExecutiveReports("free").allowed).toBe(false);
    expect(canUseExecutiveReports("growth").allowed).toBe(false);
  });

  it("allows pro", () => {
    expect(canUseExecutiveReports("pro").allowed).toBe(true);
  });
});

describe("canUseAutoPublish", () => {
  it("denies all except pro", () => {
    expect(canUseAutoPublish("free").allowed).toBe(false);
    expect(canUseAutoPublish("starter").allowed).toBe(false);
    expect(canUseAutoPublish("growth").allowed).toBe(false);
  });

  it("allows pro", () => {
    expect(canUseAutoPublish("pro").allowed).toBe(true);
  });
});

describe("canFeature", () => {
  it("returns true for features enabled on a plan", () => {
    expect(canFeature("pro", "bulkPublishing")).toBe(true);
    expect(canFeature("growth", "faqGeneration")).toBe(true);
  });

  it("returns false for features not on a plan", () => {
    expect(canFeature("free", "bulkPublishing")).toBe(false);
    expect(canFeature("starter", "faqGeneration")).toBe(false);
  });
});

describe("getContentDraftLimit", () => {
  it("returns correct limits per plan", () => {
    expect(getContentDraftLimit("free")).toBe(3);
    expect(getContentDraftLimit("starter")).toBe(50);
    expect(getContentDraftLimit("pro")).toBeGreaterThan(1000);
  });
});

describe("getOpportunityLimit", () => {
  it("returns correct limits per plan", () => {
    expect(getOpportunityLimit("free")).toBe(10);
    expect(getOpportunityLimit("starter")).toBe(100);
    expect(getOpportunityLimit("pro")).toBeGreaterThan(10000);
  });
});
