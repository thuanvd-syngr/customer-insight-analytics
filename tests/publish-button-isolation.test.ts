import { describe, expect, it } from "vitest";

import { formActionKey, isActionLoading, makeActionKey } from "~/lib/action-loading";

describe("publish button loading isolation", () => {
  it("loads only the clicked Shopify page publish button", () => {
    const formData = new FormData();
    formData.set("actionKey", makeActionKey("publish:page", "shipping_page"));

    expect(isActionLoading({
      navigationState: "submitting",
      formData,
      actionKey: makeActionKey("publish:page", "shipping_page"),
    })).toBe(true);
    expect(isActionLoading({
      navigationState: "submitting",
      formData,
      actionKey: makeActionKey("publish:page", "faq_page"),
    })).toBe(false);
  });

  it("loads only the clicked blog publish button", () => {
    const formData = new FormData();
    formData.set("actionKey", makeActionKey("publish:blog", "shipping"));

    expect(formActionKey(formData)).toBe("publish:blog:shipping");
    expect(isActionLoading({
      navigationState: "submitting",
      formData,
      actionKey: makeActionKey("publish:blog", "shipping"),
    })).toBe(true);
    expect(isActionLoading({
      navigationState: "submitting",
      formData,
      actionKey: makeActionKey("publish:blog", "payment"),
    })).toBe(false);
  });
});
