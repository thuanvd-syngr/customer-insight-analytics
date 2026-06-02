import { describe, expect, it } from "vitest";

import { isActionLoading, makeActionKey } from "~/lib/action-loading";

describe("publish retry failed", () => {
  it("retry failed loading is scoped to the failed item", () => {
    const formData = new FormData();
    formData.set("actionKey", makeActionKey("publish:retry", "failed-1"));

    expect(isActionLoading({
      navigationState: "submitting",
      formData,
      actionKey: makeActionKey("publish:retry", "failed-1"),
    })).toBe(true);
    expect(isActionLoading({
      navigationState: "submitting",
      formData,
      actionKey: makeActionKey("publish:retry", "failed-2"),
    })).toBe(false);
  });
});
