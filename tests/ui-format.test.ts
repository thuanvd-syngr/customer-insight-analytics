import { describe, expect, it } from "vitest";

import {
  compactMoney,
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
    const v = compactMoney(1200);
    expect(v.startsWith("$")).toBe(true);
    expect(v.toUpperCase()).toContain("1.2K");
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
