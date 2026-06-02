import type { InsightResult } from "~/lib/types";

export type AIProviderId = "off" | "mock" | "groq" | "gemini";

export type ContentType =
  | "faq"
  | "product_faq"
  | "shipping_faq"
  | "payment_faq"
  | "warranty_faq"
  | "return_faq"
  | "refund_faq"
  | "discount_faq"
  | "buying_guide"
  | "comparison_guide"
  | "product_comparison"
  | "competitor_comparison"
  | "feature_breakdown"
  | "product_benefits"
  | "objection_handling"
  | "why_buy_from_us";

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  faq: "General FAQ",
  product_faq: "Product FAQ",
  shipping_faq: "Shipping & Delivery FAQ",
  payment_faq: "Payment & Checkout FAQ",
  warranty_faq: "Warranty FAQ",
  return_faq: "Returns FAQ",
  refund_faq: "Refund Policy FAQ",
  discount_faq: "Discount & Promotions FAQ",
  buying_guide: "Buying Guide",
  comparison_guide: "Comparison Guide",
  product_comparison: "Product Comparison",
  competitor_comparison: "Competitor Comparison",
  feature_breakdown: "Feature Breakdown",
  product_benefits: "Product Benefits",
  objection_handling: "Objection Handling",
  why_buy_from_us: "Why Buy From Us",
};

export interface FaqEntry {
  question: string;
  answer: string;
}

export interface GeneratedContent {
  title: string;
  slug: string;
  seoTitle: string;
  metaDescription: string;
  html: string;
  plainText: string;
  faqSchema: string;
  jsonLd: string;
  source: "ai" | "rule";
}

export interface ContentGenerationInput {
  contentType: ContentType;
  groupId?: string;
  productTitle?: string;
  productId?: string;
  competitorName?: string;
  shopDomain: string;
  storeName?: string;
  faqs?: FaqEntry[];
  context?: string;
}

export interface WeeklySummaryInput {
  shopDomain: string;
  insight: InsightResult;
  weekStart: string;
  weekEnd: string;
}

export interface AIProvider {
  id: AIProviderId;
  label: string;
  isConfigured(): boolean;
  generateWeeklySummary(input: WeeklySummaryInput): Promise<string>;
  generateContent(input: ContentGenerationInput): Promise<GeneratedContent>;
}
