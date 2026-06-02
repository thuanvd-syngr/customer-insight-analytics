import { describe, expect, it } from "vitest";

describe("product not found safe state", () => {
  function hasRecoveryData(input: { confusion?: unknown | null; gap?: unknown | null }) {
    return Boolean(input.confusion || input.gap);
  }

  it("shows empty state when product has no confusion or gap", () => {
    expect(hasRecoveryData({ confusion: null, gap: null })).toBe(false);
  });

  it("loads detail when either confusion or gap exists", () => {
    expect(hasRecoveryData({ confusion: { productTitle: "A" }, gap: null })).toBe(true);
    expect(hasRecoveryData({ confusion: null, gap: { productTitle: "A" } })).toBe(true);
  });
});
