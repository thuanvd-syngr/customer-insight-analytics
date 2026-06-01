import { describe, expect, it } from "vitest";

import {
  compactMoney,
  formatCompactMoney,
  formatMoneyRange,
  formatNumber,
  formatPercent,
  money,
  progressTone,
  scoreTone,
  textTone,
  toneVar,
  trendTone,
} from "~/components/format";

describe("money / number formatting", () => {
  it("formats whole-dollar currency", () => {
    expect(money(1234)).toBe("$1,234");
    expect(money(0)).toBe("$0");
    expect(money(1234.6)).toBe("$1,235");
  });

  it("formats compact currency", () => {
    expect(compactMoney(1200)).toBe("$1.2K");
    expect(compactMoney(380)).toBe("$380");
    expect(compactMoney(1000)).toBe("$1K");
  });

  it("formats plain numbers with separators", () => {
    expect(formatNumber(12345)).toBe("12,345");
  });
});

describe("formatPercent", () => {
  it("adds a + sign for positive ratios", () => {
    expect(formatPercent(0.5)).toBe("+50%");
  });
  it("keeps the minus for negative ratios", () => {
    expect(formatPercent(-0.25)).toBe("-25%");
  });
  it("renders zero without a sign", () => {
    expect(formatPercent(0)).toBe("0%");
  });
});

describe("scoreTone", () => {
  it("is success when healthy, warning mid, critical low", () => {
    expect(scoreTone(85)).toBe("success");
    expect(scoreTone(50)).toBe("warning");
    expect(scoreTone(10)).toBe("critical");
  });
});

describe("trendTone", () => {
  it("treats a rising friction trend as bad by default", () => {
    expect(trendTone(0.4)).toBe("critical");
    expect(trendTone(-0.4)).toBe("success");
    expect(trendTone(0)).toBe("subdued");
  });
  it("inverts for metrics where rising is good", () => {
    expect(trendTone(0.4, true)).toBe("success");
    expect(trendTone(-0.4, true)).toBe("critical");
  });
});

describe("tone mappings", () => {
  it("maps tones to Polaris Text tones", () => {
    expect(textTone("success")).toBe("success");
    expect(textTone("warning")).toBe("caution");
    expect(textTone("critical")).toBe("critical");
    expect(textTone("info")).toBe("subdued");
  });
  it("maps tones to ProgressBar tones", () => {
    expect(progressTone("success")).toBe("success");
    expect(progressTone("warning")).toBe("highlight");
    expect(progressTone("critical")).toBe("critical");
    expect(progressTone("info")).toBe("primary");
  });
  it("returns a CSS variable for SVG fills", () => {
    expect(toneVar("success")).toContain("var(--p-color");
  });
});

describe("formatCompactMoney — deterministic, no Intl compact", () => {
  it("formats sub-1K as exact dollars", () => {
    expect(formatCompactMoney(380)).toBe("$380");
    expect(formatCompactMoney(0)).toBe("$0");
    expect(formatCompactMoney(99)).toBe("$99");
    expect(formatCompactMoney(999)).toBe("$999");
  });

  it("formats 1000 as $1K without trailing .0", () => {
    expect(formatCompactMoney(1000)).toBe("$1K");
    expect(formatCompactMoney(2000)).toBe("$2K");
  });

  it("formats non-round thousands with one decimal", () => {
    expect(formatCompactMoney(1200)).toBe("$1.2K");
    expect(formatCompactMoney(2500)).toBe("$2.5K");
  });

  it("never produces .0K or .0M", () => {
    expect(formatCompactMoney(1000)).not.toContain(".0K");
    expect(formatCompactMoney(2000)).not.toContain(".0K");
    expect(formatCompactMoney(1_000_000)).not.toContain(".0M");
    expect(formatCompactMoney(3_000_000)).not.toContain(".0M");
  });

  it("formats millions", () => {
    expect(formatCompactMoney(1_000_000)).toBe("$1M");
    expect(formatCompactMoney(1_500_000)).toBe("$1.5M");
  });

  it("is the same function as compactMoney (alias)", () => {
    expect(formatCompactMoney(1200)).toBe(compactMoney(1200));
    expect(formatCompactMoney(380)).toBe(compactMoney(380));
  });
});

describe("formatMoneyRange — compact range, SSR-safe", () => {
  it("formats mixed scale range", () => {
    expect(formatMoneyRange(380, 1000)).toBe("$380-$1K");
  });

  it("formats same-scale ranges", () => {
    expect(formatMoneyRange(103, 276)).toBe("$103-$276");
    expect(formatMoneyRange(1000, 2500)).toBe("$1K-$2.5K");
  });

  it("returns fallback when both values are 0", () => {
    expect(formatMoneyRange(0, 0)).toContain("Connect orders");
    expect(formatMoneyRange(null, null)).toContain("Connect orders");
  });

  it("insight recovery impact uses compact format (no .0K)", () => {
    // Regression guard: the Insights KPI used compactMoney which produced "$380.0-$1.0K"
    // on Node.js but "$380-$1K" on browsers, causing React hydration errors.
    expect(formatMoneyRange(380, 1000)).not.toContain(".0");
    expect(formatMoneyRange(1000, 2000)).not.toContain(".0");
  });
});
