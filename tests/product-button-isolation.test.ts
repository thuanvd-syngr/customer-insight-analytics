import { describe, expect, it } from "vitest";

import { isActionLoading, makeActionKey } from "~/lib/action-loading";

describe("product button loading isolation", () => {
  it("loads only the clicked product recovery pack button", () => {
    const productA = "gid://shopify/Product/111";
    const productB = "gid://shopify/Product/222";
    const formData = new FormData();
    formData.set("actionKey", makeActionKey("generate:recovery-pack", productA));

    expect(isActionLoading({
      navigationState: "submitting",
      formData,
      actionKey: makeActionKey("generate:recovery-pack", productA),
    })).toBe(true);
    expect(isActionLoading({
      navigationState: "submitting",
      formData,
      actionKey: makeActionKey("generate:recovery-pack", productB),
    })).toBe(false);
  });

  it("loads only the clicked product FAQ generation button", () => {
    const formData = new FormData();
    formData.set("actionKey", makeActionKey("generate:faq", "gid://shopify/Product/111"));

    expect(isActionLoading({
      navigationState: "submitting",
      formData,
      actionKey: makeActionKey("generate:faq", "gid://shopify/Product/111"),
    })).toBe(true);
    expect(isActionLoading({
      navigationState: "submitting",
      formData,
      actionKey: makeActionKey("generate:faq", "gid://shopify/Product/222"),
    })).toBe(false);
  });
});
