import type { ContentGenerationInput, ContentType, FaqEntry, GeneratedContent } from "./types";
import { DEFAULT_FAQS } from "~/lib/publish/content-templates";

// Maps content type to the primary friction group for rule-based fallback.
const CONTENT_GROUP: Record<ContentType, string> = {
  faq: "shipping",
  product_faq: "usage",
  shipping_faq: "shipping",
  payment_faq: "payment",
  warranty_faq: "size",
  return_faq: "return",
  refund_faq: "refund",
  discount_faq: "stock",
  buying_guide: "compare",
  comparison_guide: "compare",
  product_comparison: "compare",
  competitor_comparison: "competitor",
  feature_breakdown: "usage",
  product_benefits: "usage",
  objection_handling: "compare",
  why_buy_from_us: "competitor",
};

const CONTENT_TITLES: Record<ContentType, string> = {
  faq: "Frequently Asked Questions",
  product_faq: "Product FAQ",
  shipping_faq: "Shipping & Delivery FAQ",
  payment_faq: "Payment & Checkout FAQ",
  warranty_faq: "Warranty Information",
  return_faq: "Returns & Exchanges",
  refund_faq: "Refund Policy",
  discount_faq: "Discounts & Promotions",
  buying_guide: "Buying Guide",
  comparison_guide: "How to Compare",
  product_comparison: "Product Comparison",
  competitor_comparison: "How We Compare",
  feature_breakdown: "Feature Breakdown",
  product_benefits: "Why Our Products",
  objection_handling: "Common Questions Answered",
  why_buy_from_us: "Why Buy From Us",
};

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeJson(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function buildFaqHtml(faqs: FaqEntry[]): string {
  return faqs
    .map(
      (f) =>
        `<details class="cia-faq-item">\n  <summary><strong>${esc(f.question)}</strong></summary>\n  <p>${esc(f.answer)}</p>\n</details>`,
    )
    .join("\n");
}

function buildFaqSchemaStr(faqs: FaqEntry[]): string {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };
  return `<script type="application/ld+json">${safeJson(schema)}</script>`;
}

function buildJsonLd(input: ContentGenerationInput, faqs: FaqEntry[]): string {
  const base =
    input.contentType === "buying_guide" || input.contentType === "comparison_guide"
      ? { "@context": "https://schema.org", "@type": "HowTo", name: CONTENT_TITLES[input.contentType] }
      : faqs.length > 0
        ? {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: faqs.map((f) => ({
              "@type": "Question",
              name: f.question,
              acceptedAnswer: { "@type": "Answer", text: f.answer },
            })),
          }
        : { "@context": "https://schema.org", "@type": "Article", name: CONTENT_TITLES[input.contentType] };
  return `<script type="application/ld+json">${safeJson(base)}</script>`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function getFaqsForInput(input: ContentGenerationInput): FaqEntry[] {
  if (input.faqs && input.faqs.length > 0) return input.faqs.slice(0, 6);
  const group = input.groupId ?? CONTENT_GROUP[input.contentType];
  return (DEFAULT_FAQS[group] ?? DEFAULT_FAQS["shipping"] ?? []).slice(0, 4);
}

function buildCompetitorHtml(competitorName: string, storeName: string): string {
  return [
    `<h2>${esc(`${storeName} vs ${competitorName}`)}</h2>`,
    `<p>Customers considering ${esc(competitorName)} often ask why they should choose ${esc(storeName)}. Here's what sets us apart.</p>`,
    `<h3>Why choose ${esc(storeName)}?</h3>`,
    `<ul>`,
    `  <li>Transparent policies with clear shipping, return, and payment terms</li>`,
    `  <li>Dedicated customer support that responds quickly</li>`,
    `  <li>Product quality backed by real customer reviews</li>`,
    `  <li>Hassle-free returns and a fair refund policy</li>`,
    `</ul>`,
    `<h3>Making the right choice</h3>`,
    `<p>We encourage you to compare thoroughly. Review product specifications, read customer reviews, and check policies before buying from any store.</p>`,
  ].join("\n");
}

// Builds complete GeneratedContent from rule-based logic (no AI needed).
export function buildRuleBasedContent(input: ContentGenerationInput): GeneratedContent {
  const title =
    input.productTitle
      ? `${CONTENT_TITLES[input.contentType]}: ${input.productTitle}`
      : input.competitorName
        ? `${CONTENT_TITLES[input.contentType]}: ${input.competitorName}`
        : CONTENT_TITLES[input.contentType];

  const slug = slugify(title);
  const seoTitle = title.length > 60 ? title.slice(0, 57) + "..." : title;
  const storeName = input.storeName ?? input.shopDomain.replace(".myshopify.com", "");
  const faqs = getFaqsForInput(input);

  const metaDescription =
    input.contentType === "competitor_comparison" || input.contentType === "why_buy_from_us"
      ? `See why customers choose ${storeName}. Compare features, policies, and support before you decide.`
      : faqs.length > 0
        ? `Answers to the most common ${CONTENT_TITLES[input.contentType].toLowerCase()} questions from ${storeName} customers.`
        : `${CONTENT_TITLES[input.contentType]} from ${storeName}.`;

  const faqHtml = faqs.length > 0 ? buildFaqHtml(faqs) : "";
  const faqSchemaStr = faqs.length > 0 ? buildFaqSchemaStr(faqs) : "";

  let html: string;
  if (
    input.contentType === "competitor_comparison" ||
    input.contentType === "why_buy_from_us"
  ) {
    html = [
      `<h1>${esc(title)}</h1>`,
      buildCompetitorHtml(input.competitorName ?? "alternatives", storeName),
      faqHtml,
      faqSchemaStr,
    ]
      .filter(Boolean)
      .join("\n");
  } else if (input.contentType === "buying_guide") {
    html = [
      `<h1>${esc(title)}</h1>`,
      `<p>This guide helps you make an informed purchase decision. We answer the questions we hear most from customers.</p>`,
      `<h2>Key things to consider</h2>`,
      `<ul><li>Check sizing guides and fit notes before ordering</li><li>Review shipping times and thresholds</li><li>Read the return policy before committing</li><li>Compare features specific to your use case</li></ul>`,
      faqHtml,
      faqSchemaStr,
    ]
      .filter(Boolean)
      .join("\n");
  } else {
    html = [
      `<h1>${esc(title)}</h1>`,
      `<p>${esc(metaDescription)}</p>`,
      faqHtml,
      faqSchemaStr,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const plainText = faqs.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n\n");

  return {
    title,
    slug,
    seoTitle,
    metaDescription,
    html,
    plainText,
    faqSchema: faqSchemaStr,
    jsonLd: buildJsonLd(input, faqs),
    source: "rule",
  };
}

export function buildContentPrompt(input: ContentGenerationInput): {
  system: string;
  user: string;
} {
  const storeName = input.storeName ?? input.shopDomain.replace(".myshopify.com", "");
  const system =
    "You are an expert Shopify e-commerce content writer. Generate conversion-optimized content that reduces buying friction and answers customer questions. Respond ONLY with valid JSON — no markdown, no explanation.";

  const context = {
    contentType: input.contentType,
    storeName,
    shopDomain: input.shopDomain,
    groupId: input.groupId,
    productTitle: input.productTitle,
    competitorName: input.competitorName,
    existingFaqs: input.faqs ?? [],
    context: input.context,
  };

  const schema = `{
  "title": "string — page/article title",
  "slug": "string — URL-safe slug",
  "seoTitle": "string — max 60 chars, keyword-optimized",
  "metaDescription": "string — max 160 chars, conversion-focused",
  "html": "string — complete HTML body content with h1, h2, p, ul, details/summary FAQ items",
  "plainText": "string — plain text version without HTML",
  "faqItems": [{"question": "string", "answer": "string"}]
}`;

  const user = `Generate ${input.contentType.replace(/_/g, " ")} content for a Shopify store.

Context: ${JSON.stringify(context, null, 2)}

Required JSON schema:
${schema}

Requirements:
- html must include FAQ items as <details><summary>question</summary>answer</details> elements
- faqItems must have 4-6 entries relevant to the content type and customer friction
- seoTitle must be max 60 characters
- metaDescription must be max 160 characters and conversion-focused
- Content must directly address buying objections and set clear expectations`;

  return { system, user };
}

// Parses a raw AI text response into GeneratedContent.
// Returns null if the JSON is invalid or missing required fields.
export function parseAIContentResponse(
  rawText: string,
  input: ContentGenerationInput,
): GeneratedContent | null {
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    const title = typeof parsed.title === "string" ? parsed.title : "";
    const slug = typeof parsed.slug === "string" ? parsed.slug : slugify(title);
    const seoTitle = typeof parsed.seoTitle === "string" ? parsed.seoTitle.slice(0, 60) : title.slice(0, 60);
    const metaDescription =
      typeof parsed.metaDescription === "string" ? parsed.metaDescription.slice(0, 160) : "";
    const html = typeof parsed.html === "string" ? parsed.html : "";
    const plainText = typeof parsed.plainText === "string" ? parsed.plainText : "";
    const rawFaqs = Array.isArray(parsed.faqItems) ? (parsed.faqItems as unknown[]) : [];
    const faqs: FaqEntry[] = rawFaqs
      .filter((f): f is { question: string; answer: string } => {
        return (
          typeof f === "object" &&
          f !== null &&
          typeof (f as Record<string, unknown>).question === "string" &&
          typeof (f as Record<string, unknown>).answer === "string"
        );
      })
      .map((f) => ({ question: f.question, answer: f.answer }));

    if (!title || !html) return null;

    const faqSchema = faqs.length > 0 ? buildFaqSchemaStr(faqs) : "";
    const jsonLd = buildJsonLd(input, faqs);

    return { title, slug, seoTitle, metaDescription, html, plainText, faqSchema, jsonLd, source: "ai" };
  } catch {
    return null;
  }
}
