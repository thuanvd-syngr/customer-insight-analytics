import { describe, expect, it } from "vitest";

import { detectFaqOpportunities } from "~/lib/engine";
import type { KeywordGroupResult } from "~/lib/types";

const shippingGroup: KeywordGroupResult = {
  groupId: "shipping",
  label: "Shipping",
  count: 5,
  uniqueMessages: 5,
  keywords: [{ keyword: "shipping", count: 5 }],
  trend7: 0,
  trend30: 0,
  frictionWeight: 0.8,
};

describe("faq opportunities", () => {
  it("returns uncovered opportunities", () => {
    const results = detectFaqOpportunities([shippingGroup], [], []);
    expect(results[0]?.groupId).toBe("shipping");
    expect(results[0]?.hasContent).toBe(false);
  });

  it("does not return covered topics", () => {
    const results = detectFaqOpportunities(
      [shippingGroup],
      [],
      [{ title: "Shipping", body: "Shipping cost and international shipping are covered." }],
    );
    expect(results).toHaveLength(0);
  });
});
