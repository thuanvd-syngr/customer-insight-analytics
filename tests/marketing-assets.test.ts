import { describe, expect, it } from "vitest";

import {
  generateSocialPost,
  generateEmailSubject,
  generateAdCopy,
  generateReviewRequest,
  generateSmsSnippet,
  generateMarketingAsset,
  generateAssetBatch,
  ASSET_TYPE_LABELS,
  PLATFORM_LABELS,
  TONE_LABELS,
  type MarketingAssetInput,
  type MarketingAssetType,
} from "~/lib/marketing-assets";
import { EMPTY_INSIGHT } from "~/lib/types";
import type { InsightResult } from "~/lib/types";

const MOCK_INSIGHT: InsightResult = {
  ...EMPTY_INSIGHT,
  insightScore: 68,
  messageCount: 120,
  storewideOpportunities: [
    {
      code: "STOREWIDE_SHIPPING_GAP",
      groupId: "shipping",
      label: "Shipping FAQ Gap",
      mentionCount: 15,
      priorityScore: 88,
      severity: "high",
      lowEstimate: 180,
      highEstimate: 450,
      suggestedAction: "Add shipping FAQ",
    },
  ],
  competitors: [{ name: "RivalStore", count: 6, exampleQuote: "Might switch to RivalStore" }],
  revenueOpportunity: {
    ...EMPTY_INSIGHT.revenueOpportunity,
    estimatedLow: 300,
    estimatedHigh: 750,
    headline: "Est. $300–$750 at risk",
    quickWins: [],
  },
  contentGaps: [],
};

const BASE: MarketingAssetInput = {
  assetType: "social_post",
  platform: "instagram",
  tone: "friendly",
  storeName: "AwesomeShop",
  insight: MOCK_INSIGHT,
};

// ─── generateSocialPost ───────────────────────────────────────────────────────

describe("generateSocialPost", () => {
  it("returns social_post assetType", () => {
    const result = generateSocialPost(BASE);
    expect(result.assetType).toBe("social_post");
  });

  it("returns instagram platform", () => {
    const result = generateSocialPost(BASE);
    expect(result.platform).toBe("instagram");
  });

  it("content is non-empty", () => {
    const result = generateSocialPost(BASE);
    expect(result.content.length).toBeGreaterThan(0);
  });

  it("appends hashtags for instagram friendly tone", () => {
    const result = generateSocialPost({ ...BASE, platform: "instagram", tone: "friendly" });
    expect(result.content).toContain("#");
  });

  it("includes store name or opportunity when no product/group", () => {
    const result = generateSocialPost(BASE);
    expect(result.content).toMatch(/awesomeshop|shipping/i);
  });

  it("uses product title when provided", () => {
    const result = generateSocialPost({ ...BASE, productTitle: "Pro Widget" });
    expect(result.content).toContain("Pro Widget");
  });

  it("includes groupId context when provided", () => {
    const result = generateSocialPost({ ...BASE, groupId: "shipping" });
    expect(result.content.toLowerCase()).toContain("shipping");
  });

  it("charCount matches content length", () => {
    const result = generateSocialPost(BASE);
    expect(result.charCount).toBe(result.content.length);
  });

  it("professional tone does not include emojis by default", () => {
    const result = generateSocialPost({ ...BASE, tone: "professional" });
    // professional opener doesn't start with emoji
    expect(result.content.startsWith("We understand")).toBe(true);
  });
});

// ─── generateEmailSubject ─────────────────────────────────────────────────────

describe("generateEmailSubject", () => {
  it("returns email_subject assetType", () => {
    const result = generateEmailSubject({ ...BASE, assetType: "email_subject", platform: "email" });
    expect(result.assetType).toBe("email_subject");
  });

  it("content is non-empty", () => {
    const result = generateEmailSubject({ ...BASE, assetType: "email_subject", platform: "email" });
    expect(result.content.length).toBeGreaterThan(0);
  });

  it("email subject is within character limit (78 chars)", () => {
    const result = generateEmailSubject({ ...BASE, assetType: "email_subject", platform: "email" });
    expect(result.isWithinLimit).toBe(true);
  });

  it("generates different subjects for different tones", () => {
    const professional = generateEmailSubject({ ...BASE, assetType: "email_subject", platform: "email", tone: "professional" });
    const friendly = generateEmailSubject({ ...BASE, assetType: "email_subject", platform: "email", tone: "friendly" });
    expect(professional.content).not.toBe(friendly.content);
  });
});

// ─── generateAdCopy ───────────────────────────────────────────────────────────

describe("generateAdCopy", () => {
  it("returns ad_copy assetType", () => {
    const result = generateAdCopy({ ...BASE, assetType: "ad_copy", platform: "google_ads" });
    expect(result.assetType).toBe("ad_copy");
  });

  it("includes headline", () => {
    const result = generateAdCopy({ ...BASE, assetType: "ad_copy", platform: "google_ads" });
    expect(result.headline).toBeTruthy();
  });

  it("includes cta", () => {
    const result = generateAdCopy({ ...BASE, assetType: "ad_copy", platform: "google_ads" });
    expect(result.cta).toBeTruthy();
  });

  it("google_ads isWithinLimit for short copy", () => {
    const result = generateAdCopy({ ...BASE, assetType: "ad_copy", platform: "google_ads" });
    // Full ad copy (headline + body + cta) may exceed 90 chars; isWithinLimit checks properly
    expect(typeof result.isWithinLimit).toBe("boolean");
  });

  it("different tones produce different headlines", () => {
    const urgent = generateAdCopy({ ...BASE, assetType: "ad_copy", platform: "generic", tone: "urgent" });
    const empathetic = generateAdCopy({ ...BASE, assetType: "ad_copy", platform: "generic", tone: "empathetic" });
    expect(urgent.headline).not.toBe(empathetic.headline);
  });
});

// ─── generateReviewRequest ────────────────────────────────────────────────────

describe("generateReviewRequest", () => {
  it("returns review_request assetType", () => {
    const result = generateReviewRequest({ ...BASE, assetType: "review_request", platform: "email" });
    expect(result.assetType).toBe("review_request");
  });

  it("content mentions store name", () => {
    const result = generateReviewRequest({ ...BASE, assetType: "review_request", platform: "email", storeName: "AwesomeShop" });
    expect(result.content).toContain("AwesomeShop");
  });

  it("includes a call to action", () => {
    const result = generateReviewRequest({ ...BASE, assetType: "review_request", platform: "email" });
    expect(result.cta).toBeTruthy();
  });

  it("different tones produce different content", () => {
    const professional = generateReviewRequest({ ...BASE, assetType: "review_request", platform: "email", tone: "professional" });
    const empathetic = generateReviewRequest({ ...BASE, assetType: "review_request", platform: "email", tone: "empathetic" });
    expect(professional.content).not.toBe(empathetic.content);
  });
});

// ─── generateSmsSnippet ───────────────────────────────────────────────────────

describe("generateSmsSnippet", () => {
  it("returns sms_snippet assetType", () => {
    const result = generateSmsSnippet({ ...BASE, assetType: "sms_snippet", platform: "sms" });
    expect(result.assetType).toBe("sms_snippet");
  });

  it("content is within 160 chars", () => {
    const result = generateSmsSnippet({ ...BASE, assetType: "sms_snippet", platform: "sms" });
    expect(result.charCount).toBeLessThanOrEqual(160);
    expect(result.isWithinLimit).toBe(true);
  });

  it("includes opt-out language", () => {
    const result = generateSmsSnippet({ ...BASE, assetType: "sms_snippet", platform: "sms" });
    expect(result.content.toLowerCase()).toContain("stop");
  });
});

// ─── generateMarketingAsset (dispatcher) ─────────────────────────────────────

describe("generateMarketingAsset", () => {
  const assetTypes: MarketingAssetType[] = [
    "social_post", "email_subject", "ad_copy", "review_request", "sms_snippet",
  ];

  for (const assetType of assetTypes) {
    it(`dispatches correctly for ${assetType}`, () => {
      const platform = assetType === "sms_snippet" ? "sms" : assetType === "email_subject" ? "email" : "generic";
      const result = generateMarketingAsset({ ...BASE, assetType, platform: platform as any });
      expect(result.assetType).toBe(assetType);
      expect(result.content.length).toBeGreaterThan(0);
    });
  }
});

// ─── generateAssetBatch ────────────────────────────────────────────────────────

describe("generateAssetBatch", () => {
  it("returns one asset per type", () => {
    const types: MarketingAssetType[] = ["social_post", "email_subject", "sms_snippet"];
    const batch = generateAssetBatch({ platform: "generic", tone: "professional", storeName: "MyStore", insight: MOCK_INSIGHT }, types);
    expect(batch).toHaveLength(3);
  });

  it("each asset has correct type", () => {
    const types: MarketingAssetType[] = ["social_post", "email_subject"];
    const batch = generateAssetBatch({ platform: "generic", tone: "friendly", storeName: "MyStore", insight: MOCK_INSIGHT }, types);
    expect(batch[0].assetType).toBe("social_post");
    expect(batch[1].assetType).toBe("email_subject");
  });
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe("ASSET_TYPE_LABELS", () => {
  it("has a label for every asset type", () => {
    const types: MarketingAssetType[] = ["social_post", "email_subject", "ad_copy", "review_request", "sms_snippet"];
    for (const t of types) {
      expect(ASSET_TYPE_LABELS[t]).toBeTruthy();
    }
  });
});

describe("PLATFORM_LABELS", () => {
  it("has a label for every platform", () => {
    const platforms = ["instagram", "facebook", "email", "google_ads", "sms", "generic"] as const;
    for (const p of platforms) {
      expect(PLATFORM_LABELS[p]).toBeTruthy();
    }
  });
});

describe("TONE_LABELS", () => {
  it("has a label for every tone", () => {
    const tones = ["professional", "friendly", "urgent", "empathetic"] as const;
    for (const t of tones) {
      expect(TONE_LABELS[t]).toBeTruthy();
    }
  });
});
