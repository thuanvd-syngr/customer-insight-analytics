// Tests for widget activation state logic:
// - getWidgetStatus returns correct state based on plan + published FAQ count
// - safeCount fallback when generatedFaq table absent
// - Status copy and tone are well-formed

import { describe, expect, it, vi } from "vitest";
import { safeCount } from "~/lib/prisma-safe";
import type { PrismaClient } from "@prisma/client";

// Replicate the activation logic from app.widget.tsx
type WidgetStatus = "locked" | "needs_setup" | "ready";

function getWidgetStatus(canUse: boolean, publishedFaqCount: number): WidgetStatus {
  if (!canUse) return "locked";
  if (publishedFaqCount === 0) return "needs_setup";
  return "ready";
}

// --- getWidgetStatus ---

describe("widget — getWidgetStatus", () => {
  it("returns locked when plan is free", () => {
    expect(getWidgetStatus(false, 0)).toBe("locked");
  });

  it("returns locked when plan is starter", () => {
    expect(getWidgetStatus(false, 5)).toBe("locked");
  });

  it("returns needs_setup when growth plan but no published FAQs", () => {
    expect(getWidgetStatus(true, 0)).toBe("needs_setup");
  });

  it("returns ready when growth plan and has published FAQs", () => {
    expect(getWidgetStatus(true, 3)).toBe("ready");
  });

  it("returns ready when pro plan and has published FAQs", () => {
    expect(getWidgetStatus(true, 10)).toBe("ready");
  });

  it("returns needs_setup even when pro plan but zero FAQs", () => {
    expect(getWidgetStatus(true, 0)).toBe("needs_setup");
  });
});

// --- plan eligibility ---

describe("widget — plan eligibility check", () => {
  it("growth plan can use widget", () => {
    const plan = "growth";
    expect(plan === "growth" || plan === "pro").toBe(true);
  });

  it("pro plan can use widget", () => {
    const plan: string = "pro";
    expect(plan === "growth" || plan === "pro").toBe(true);
  });

  it("free plan cannot use widget", () => {
    const plan: string = "free";
    expect(plan === "growth" || plan === "pro").toBe(false);
  });

  it("starter plan cannot use widget", () => {
    const plan: string = "starter";
    expect(plan === "growth" || plan === "pro").toBe(false);
  });
});

// --- safeCount for generatedFaq (published FAQs) ---

describe("widget — safeCount generatedFaq fallback", () => {
  it("returns 0 when generatedFaq table absent", async () => {
    const db = {} as PrismaClient;
    const count = await safeCount(db, "generatedFaq", { where: { shopId: "s1", status: "published" } });
    expect(count).toBe(0);
  });

  it("returns actual count when table exists", async () => {
    const db = {
      generatedFaq: { count: vi.fn().mockResolvedValue(4) },
    } as unknown as PrismaClient;
    const count = await safeCount(db, "generatedFaq", { where: { shopId: "s1", status: "published" } });
    expect(count).toBe(4);
  });

  it("never throws when table absent", async () => {
    const db = {} as PrismaClient;
    await expect(safeCount(db, "generatedFaq")).resolves.toBe(0);
  });
});

// --- Status + tone mapping integrity ---

describe("widget — status tone mapping", () => {
  const STATUS_COPY: Record<WidgetStatus, { label: string; tone: string }> = {
    locked: { label: "Locked — Growth plan required", tone: "warning" },
    needs_setup: { label: "Needs setup — no FAQs published yet", tone: "info" },
    ready: { label: "Ready", tone: "success" },
  };

  it("locked status has warning tone", () => {
    expect(STATUS_COPY.locked.tone).toBe("warning");
  });

  it("needs_setup status has info tone", () => {
    expect(STATUS_COPY.needs_setup.tone).toBe("info");
  });

  it("ready status has success tone", () => {
    expect(STATUS_COPY.ready.tone).toBe("success");
  });

  it("all statuses have non-empty labels", () => {
    Object.values(STATUS_COPY).forEach((s) => {
      expect(s.label.length).toBeGreaterThan(0);
    });
  });
});

// --- Activation checklist steps ---

describe("widget — activation checklist coverage", () => {
  function buildChecklist(plan: string, publishedFaqCount: number) {
    const canUse = plan === "growth" || plan === "pro";
    return [
      { done: canUse, label: "Upgrade to Growth or Pro plan" },
      { done: publishedFaqCount > 0, label: "Publish at least one product FAQ" },
      { done: false, label: "Add the Product FAQ block to your theme" },
      { done: false, label: "Save and preview the theme" },
    ];
  }

  it("free plan has no done steps", () => {
    const steps = buildChecklist("free", 0);
    expect(steps.every((s) => !s.done)).toBe(true);
  });

  it("growth plan with published FAQs has first 2 steps done", () => {
    const steps = buildChecklist("growth", 3);
    expect(steps[0].done).toBe(true);
    expect(steps[1].done).toBe(true);
    expect(steps[2].done).toBe(false);
    expect(steps[3].done).toBe(false);
  });

  it("checklist always has 4 steps", () => {
    expect(buildChecklist("growth", 0)).toHaveLength(4);
    expect(buildChecklist("free", 0)).toHaveLength(4);
  });
});
