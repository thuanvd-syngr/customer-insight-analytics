import { describe, expect, it } from "vitest";
import {
  buildOnboardingChecklist,
  isFirstRun,
  STEP_LABELS,
  type OnboardingInput,
} from "~/lib/onboarding";

const BLANK: OnboardingInput = {
  hasRunInsight: false,
  hasOpportunity: false,
  hasFaq: false,
  hasPublished: false,
  hasBulkJob: false,
  hasBilling: false,
  hasCompetitor: false,
};

const FULL: OnboardingInput = {
  hasRunInsight: true,
  hasOpportunity: true,
  hasFaq: true,
  hasPublished: true,
  hasBulkJob: true,
  hasBilling: true,
  hasCompetitor: true,
};

describe("buildOnboardingChecklist — blank state", () => {
  it("returns 8 steps", () => {
    const cl = buildOnboardingChecklist(BLANK);
    expect(cl.steps).toHaveLength(8);
  });

  it("install_complete is always completed", () => {
    const cl = buildOnboardingChecklist(BLANK);
    const step = cl.steps.find((s) => s.id === "install_complete");
    expect(step?.completed).toBe(true);
  });

  it("billing_setup is not completed when no billing", () => {
    const cl = buildOnboardingChecklist(BLANK);
    const step = cl.steps.find((s) => s.id === "billing_setup");
    expect(step?.completed).toBe(false);
  });

  it("completedCount is 1 (only install_complete)", () => {
    const cl = buildOnboardingChecklist(BLANK);
    expect(cl.completedCount).toBe(1);
  });

  it("totalCount is 8", () => {
    expect(buildOnboardingChecklist(BLANK).totalCount).toBe(8);
  });

  it("progress is 12 or 13 (1/8 rounded)", () => {
    const cl = buildOnboardingChecklist(BLANK);
    expect(cl.progress).toBe(Math.round((1 / 8) * 100));
  });

  it("isComplete is false when required steps pending", () => {
    expect(buildOnboardingChecklist(BLANK).isComplete).toBe(false);
  });

  it("nextStep is billing_setup (order 2)", () => {
    const cl = buildOnboardingChecklist(BLANK);
    expect(cl.nextStep?.id).toBe("billing_setup");
  });
});

describe("buildOnboardingChecklist — full state", () => {
  it("completedCount equals totalCount", () => {
    const cl = buildOnboardingChecklist(FULL);
    expect(cl.completedCount).toBe(cl.totalCount);
  });

  it("progress is 100", () => {
    expect(buildOnboardingChecklist(FULL).progress).toBe(100);
  });

  it("isComplete is true", () => {
    expect(buildOnboardingChecklist(FULL).isComplete).toBe(true);
  });

  it("nextStep is null", () => {
    expect(buildOnboardingChecklist(FULL).nextStep).toBeNull();
  });
});

describe("buildOnboardingChecklist — partial state", () => {
  it("marks first_analysis completed when hasRunInsight", () => {
    const cl = buildOnboardingChecklist({ ...BLANK, hasRunInsight: true });
    const step = cl.steps.find((s) => s.id === "first_analysis");
    expect(step?.completed).toBe(true);
  });

  it("marks first_faq completed when hasFaq", () => {
    const cl = buildOnboardingChecklist({ ...BLANK, hasFaq: true });
    const step = cl.steps.find((s) => s.id === "first_faq");
    expect(step?.completed).toBe(true);
  });

  it("marks first_publish completed when hasPublished", () => {
    const cl = buildOnboardingChecklist({ ...BLANK, hasPublished: true });
    expect(cl.steps.find((s) => s.id === "first_publish")?.completed).toBe(true);
  });

  it("marks competitor_review completed when hasCompetitor", () => {
    const cl = buildOnboardingChecklist({ ...BLANK, hasCompetitor: true });
    expect(cl.steps.find((s) => s.id === "competitor_review")?.completed).toBe(true);
  });

  it("requiredCompleted increments correctly", () => {
    const cl = buildOnboardingChecklist({ ...BLANK, hasBilling: true, hasRunInsight: true });
    // install_complete (always) + billing_setup + first_analysis = 3 required completed
    expect(cl.requiredCompleted).toBeGreaterThanOrEqual(3);
  });

  it("steps are ordered by order field", () => {
    const cl = buildOnboardingChecklist(BLANK);
    const orders = cl.steps.map((s) => s.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("required steps have required=true", () => {
    const cl = buildOnboardingChecklist(BLANK);
    const required = cl.steps.filter((s) => s.required);
    expect(required.length).toBeGreaterThan(0);
    expect(required.every((s) => ["install_complete", "billing_setup", "first_analysis", "first_opportunity"].includes(s.id))).toBe(true);
  });
});

describe("isFirstRun", () => {
  it("returns true for fully blank merchant", () => {
    expect(isFirstRun(BLANK)).toBe(true);
  });
  it("returns false once insight run", () => {
    expect(isFirstRun({ ...BLANK, hasRunInsight: true })).toBe(false);
  });
  it("returns false once FAQ created", () => {
    expect(isFirstRun({ ...BLANK, hasFaq: true })).toBe(false);
  });
  it("returns false once content published", () => {
    expect(isFirstRun({ ...BLANK, hasPublished: true })).toBe(false);
  });
});

describe("STEP_LABELS", () => {
  it("has all 8 step IDs", () => {
    const ids = Object.keys(STEP_LABELS);
    expect(ids).toContain("install_complete");
    expect(ids).toContain("billing_setup");
    expect(ids).toContain("first_analysis");
    expect(ids).toContain("first_opportunity");
    expect(ids).toContain("first_faq");
    expect(ids).toContain("first_publish");
    expect(ids).toContain("first_bulk_job");
    expect(ids).toContain("competitor_review");
  });
  it("all labels are non-empty strings", () => {
    for (const label of Object.values(STEP_LABELS)) {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
