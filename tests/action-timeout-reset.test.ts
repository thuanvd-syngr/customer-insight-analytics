import { describe, expect, it } from "vitest";

import { ACTION_TIMEOUT_MS, actionTimedOut } from "~/lib/action-loading";

describe("action timeout reset", () => {
  it("does not time out before five minutes", () => {
    expect(actionTimedOut(1_000, 1_000 + ACTION_TIMEOUT_MS - 1)).toBe(false);
  });

  it("times out at five minutes so UI can reset loading state", () => {
    expect(actionTimedOut(1_000, 1_000 + ACTION_TIMEOUT_MS)).toBe(true);
  });

  it("does not time out when no action is pending", () => {
    expect(actionTimedOut(null, Date.now())).toBe(false);
  });
});
