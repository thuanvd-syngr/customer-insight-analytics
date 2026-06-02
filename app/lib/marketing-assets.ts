// Marketing Assets Generator — rule-based content for social, email, ads, and SMS.
// All pure functions; no DB or network access.

import type { InsightResult } from "~/lib/types";

export type MarketingAssetType =
  | "social_post"
  | "email_subject"
  | "ad_copy"
  | "review_request"
  | "sms_snippet";

export type MarketingPlatform =
  | "instagram"
  | "facebook"
  | "email"
  | "google_ads"
  | "sms"
  | "generic";

export type MarketingTone = "professional" | "friendly" | "urgent" | "empathetic";

export interface MarketingAssetInput {
  assetType: MarketingAssetType;
  platform: MarketingPlatform;
  tone: MarketingTone;
  storeName: string;
  groupId?: string;
  productTitle?: string;
  insight: InsightResult;
}

export interface GeneratedMarketingAsset {
  assetType: MarketingAssetType;
  platform: MarketingPlatform;
  content: string;
  headline?: string;
  cta?: string;
  tone: MarketingTone;
  charCount: number;
  isWithinLimit: boolean;
}

export const ASSET_TYPE_LABELS: Record<MarketingAssetType, string> = {
  social_post: "Social Post",
  email_subject: "Email Subject Line",
  ad_copy: "Ad Copy",
  review_request: "Review Request",
  sms_snippet: "SMS Snippet",
};

export const PLATFORM_LABELS: Record<MarketingPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  email: "Email",
  google_ads: "Google Ads",
  sms: "SMS",
  generic: "Generic",
};

export const TONE_LABELS: Record<MarketingTone, string> = {
  professional: "Professional",
  friendly: "Friendly & Casual",
  urgent: "Urgent & Action-Oriented",
  empathetic: "Empathetic & Caring",
};

// Platform character limits
const CHAR_LIMITS: Record<MarketingPlatform, number> = {
  instagram: 2200,
  facebook: 63206,
  email: 78,
  google_ads: 90,
  sms: 160,
  generic: 500,
};

type ToneAdverb = Record<MarketingTone, string>;
type ToneCta = Record<MarketingTone, string>;

const TONE_OPENERS: ToneAdverb = {
  professional: "We understand that clarity matters.",
  friendly: "Hey there! 👋",
  urgent: "Don't miss out —",
  empathetic: "We hear you, and we care.",
};

const TONE_CTAS: ToneCta = {
  professional: "Learn more →",
  friendly: "Check it out!",
  urgent: "Act now →",
  empathetic: "Let us help →",
};

function pickToneOpener(tone: MarketingTone): string {
  return TONE_OPENERS[tone];
}

function pickToneCta(tone: MarketingTone): string {
  return TONE_CTAS[tone];
}

function applyCharLimit(text: string, platform: MarketingPlatform): { content: string; isWithinLimit: boolean } {
  const limit = CHAR_LIMITS[platform];
  if (text.length <= limit) return { content: text, isWithinLimit: true };
  return { content: text.slice(0, limit - 3) + "...", isWithinLimit: false };
}

export function generateSocialPost(input: MarketingAssetInput): GeneratedMarketingAsset {
  const { storeName, tone, platform, groupId, productTitle, insight } = input;
  const topOpp = insight.storewideOpportunities[0];
  const rev = insight.revenueOpportunity;

  let body: string;
  const opener = pickToneOpener(tone);
  const cta = pickToneCta(tone);

  if (productTitle) {
    body = `${opener} ${productTitle} is now even better — we've answered your top questions so shopping is simpler. ${cta}`;
  } else if (groupId === "shipping") {
    body = `${opener} Your shipping questions, answered. Free shipping details, delivery times, and tracking info — all in one place. ${cta}`;
  } else if (groupId === "return") {
    body = `${opener} Hassle-free returns, guaranteed. Our clear return policy means you shop with confidence. ${cta}`;
  } else if (topOpp) {
    body = `${opener} ${topOpp.label} — we've made it easier to find answers so you can shop with confidence at ${storeName}. ${cta}`;
  } else {
    body = `${opener} At ${storeName}, your questions matter. We've published clear, helpful answers to make your shopping experience better. ${cta}`;
  }

  if (platform === "instagram" && tone !== "professional") {
    body += "\n\n#shopsmarter #customerservice #faqs";
  }

  const { content, isWithinLimit } = applyCharLimit(body, platform);
  return {
    assetType: "social_post",
    platform,
    content,
    cta,
    tone,
    charCount: content.length,
    isWithinLimit,
  };
}

export function generateEmailSubject(input: MarketingAssetInput): GeneratedMarketingAsset {
  const { storeName, tone, groupId, productTitle } = input;

  const subjects: Record<MarketingTone, string[]> = {
    professional: [
      `Your questions about ${productTitle ?? storeName} — answered`,
      `New: Complete ${groupId ?? "FAQ"} guide for ${storeName} customers`,
      `Important shipping & returns update from ${storeName}`,
    ],
    friendly: [
      `We heard you! Here's what you wanted to know 😊`,
      `Quick answers to your top ${groupId ?? "shopping"} questions`,
      `New FAQ page just for you — ${storeName}`,
    ],
    urgent: [
      `Your order questions — answered NOW`,
      `Don't miss our updated ${groupId ?? "FAQ"} guide`,
      `Time-sensitive: New shipping policy at ${storeName}`,
    ],
    empathetic: [
      `We understand your concerns — here's clarity`,
      `We listened. Here are answers to your biggest questions`,
      `Your shopping experience matters to us at ${storeName}`,
    ],
  };

  const options = subjects[tone];
  const content = options[0]; // deterministic: always first

  const { content: trimmed, isWithinLimit } = applyCharLimit(content, "email");
  return {
    assetType: "email_subject",
    platform: "email",
    content: trimmed,
    tone,
    charCount: trimmed.length,
    isWithinLimit,
  };
}

export function generateAdCopy(input: MarketingAssetInput): GeneratedMarketingAsset {
  const { storeName, tone, groupId, productTitle, platform } = input;

  const headlines: Record<MarketingTone, string> = {
    professional: `${storeName} — Clear Answers. Confident Shopping.`,
    friendly: `Shop ${storeName} With Confidence!`,
    urgent: `Stop Wondering. Start Shopping — ${storeName}`,
    empathetic: `We Answer Every Question — ${storeName}`,
  };

  const bodies: Record<MarketingTone, string> = {
    professional: `${productTitle ?? storeName} — complete ${groupId ?? "FAQ"} guide available. Make informed decisions with full transparency.`,
    friendly: `Got questions about ${groupId ?? "our products"}? We've got answers! Shop ${storeName} knowing exactly what to expect.`,
    urgent: `Limited time: Get all your ${groupId ?? "product"} questions answered now. Shop confidently at ${storeName}.`,
    empathetic: `We know shopping online can feel uncertain. That's why we've answered every question about ${groupId ?? "our store"} — upfront.`,
  };

  const headline = headlines[tone];
  const body = bodies[tone];
  const cta = pickToneCta(tone);
  const fullContent = `${headline}\n${body}\n${cta}`;

  const { content, isWithinLimit } = applyCharLimit(fullContent, platform);
  return {
    assetType: "ad_copy",
    platform,
    content,
    headline,
    cta,
    tone,
    charCount: content.length,
    isWithinLimit,
  };
}

export function generateReviewRequest(input: MarketingAssetInput): GeneratedMarketingAsset {
  const { storeName, tone } = input;

  const templates: Record<MarketingTone, string> = {
    professional: `Thank you for choosing ${storeName}. Your feedback helps other customers make informed decisions. Would you take 2 minutes to leave a review?`,
    friendly: `Hey! Hope you're loving your purchase from ${storeName} 😊 We'd love to hear what you think — your review means the world to us!`,
    urgent: `Quick favor: Your review can help others decide. Takes 60 seconds — would you share your ${storeName} experience now?`,
    empathetic: `We hope your experience at ${storeName} met your expectations. If you have a moment, your honest review helps us serve you better. No pressure, but every word counts.`,
  };

  const cta = tone === "friendly" ? "Leave a review →" : "Share your feedback →";
  const content = templates[tone];

  return {
    assetType: "review_request",
    platform: "email",
    content,
    cta,
    tone,
    charCount: content.length,
    isWithinLimit: content.length <= CHAR_LIMITS["email"] * 10, // emails have high limit
  };
}

export function generateSmsSnippet(input: MarketingAssetInput): GeneratedMarketingAsset {
  const { storeName, tone, groupId } = input;

  const templates: Record<MarketingTone, string> = {
    professional: `${storeName}: Your ${groupId ?? "FAQ"} questions answered at [link]. Reply STOP to opt out.`,
    friendly: `Hi! Your top ${groupId ?? "shopping"} Qs answered at ${storeName} → [link] Txt STOP to end.`,
    urgent: `ACT NOW: ${storeName} FAQ updated! Get answers before you shop → [link] Txt STOP to end.`,
    empathetic: `We care about your experience at ${storeName}. Find answers to your questions → [link] Reply STOP to opt out.`,
  };

  const content = templates[tone];
  const { content: trimmed, isWithinLimit } = applyCharLimit(content, "sms");

  return {
    assetType: "sms_snippet",
    platform: "sms",
    content: trimmed,
    cta: "[link]",
    tone,
    charCount: trimmed.length,
    isWithinLimit,
  };
}

export function generateMarketingAsset(input: MarketingAssetInput): GeneratedMarketingAsset {
  switch (input.assetType) {
    case "social_post":
      return generateSocialPost(input);
    case "email_subject":
      return generateEmailSubject(input);
    case "ad_copy":
      return generateAdCopy(input);
    case "review_request":
      return generateReviewRequest(input);
    case "sms_snippet":
      return generateSmsSnippet(input);
  }
}

export function generateAssetBatch(
  baseInput: Omit<MarketingAssetInput, "assetType">,
  assetTypes: MarketingAssetType[],
): GeneratedMarketingAsset[] {
  return assetTypes.map((assetType) => generateMarketingAsset({ ...baseInput, assetType }));
}
