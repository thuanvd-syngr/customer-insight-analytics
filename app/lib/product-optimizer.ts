// Product content optimizer — generates AI or rule-based rewrites for product sections.
// Pure module: no Prisma, no Shopify API. Route layer owns persistence.

export type ProductSectionType =
  | "description"
  | "seo_title"
  | "meta_description"
  | "benefits"
  | "objection_handling"
  | "comparison"
  | "trust"
  | "warranty"
  | "shipping"
  | "return";

export const SECTION_TYPE_LABELS: Record<ProductSectionType, string> = {
  description: "Product Description",
  seo_title: "SEO Title",
  meta_description: "Meta Description",
  benefits: "Product Benefits",
  objection_handling: "Objection Handling",
  comparison: "Comparison Section",
  trust: "Trust & Credibility",
  warranty: "Warranty Information",
  shipping: "Shipping Information",
  return: "Return Policy",
};

export interface ProductOptimizationInput {
  productId: string;
  productTitle: string;
  sectionType: ProductSectionType;
  originalContent?: string;
  storeName?: string;
  shopDomain?: string;
  additionalContext?: string;
}

export interface ProductOptimizationResult {
  sectionType: ProductSectionType;
  draftContent: string;
  draftHtml: string;
  source: "ai" | "rule";
  characterCount: number;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function h(tag: string, content: string, attrs = ""): string {
  return `<${tag}${attrs ? " " + attrs : ""}>${content}</${tag}>`;
}

function li(items: string[]): string {
  return `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
}

/**
 * Rule-based product section generator.
 * Returns complete plain text + HTML without any API calls.
 */
export function buildRuleBasedProductSection(
  input: ProductOptimizationInput,
): ProductOptimizationResult {
  const { productTitle, sectionType, storeName } = input;
  const store = storeName ?? "our store";
  const title = escHtml(productTitle);

  let draftContent = "";
  let draftHtml = "";

  switch (sectionType) {
    case "description": {
      draftContent = `${productTitle} is designed to deliver quality, durability, and value. Whether you're a first-time buyer or a returning customer, ${productTitle} offers the features you need with the reliability you expect from ${store}.`;
      draftHtml = h("div", h("p", escHtml(draftContent)));
      break;
    }
    case "seo_title": {
      draftContent = `${productTitle} | ${store}`;
      if (draftContent.length > 60) draftContent = draftContent.slice(0, 57) + "…";
      draftHtml = h("title", escHtml(draftContent));
      break;
    }
    case "meta_description": {
      draftContent = `Shop ${productTitle} at ${store}. Fast shipping, easy returns, and our quality guarantee. Order today.`;
      if (draftContent.length > 160) draftContent = draftContent.slice(0, 157) + "…";
      draftHtml = `<meta name="description" content="${escHtml(draftContent)}" />`;
      break;
    }
    case "benefits": {
      const benefits = [
        `Premium quality materials built to last`,
        `Designed for reliability and everyday use`,
        `Backed by our customer satisfaction guarantee`,
        `Fast and tracked shipping on every order`,
        `Easy 30-day returns if not fully satisfied`,
      ];
      draftContent = benefits.join("\n");
      draftHtml = h("div", h("h3", `Why choose ${title}?`) + li(benefits));
      break;
    }
    case "objection_handling": {
      const questions = [
        ["Is this worth the price?", `${title} is priced to reflect its quality. We compare favourably with similar products and back every purchase with our satisfaction guarantee.`],
        ["What if it doesn't fit or work for me?", `No problem — our 30-day return policy means you can shop with confidence.`],
        ["How quickly will I receive it?", `Most orders ship within 1–2 business days with full tracking provided.`],
      ];
      draftContent = questions.map(([q, a]) => `Q: ${q}\nA: ${a}`).join("\n\n");
      draftHtml = h(
        "div",
        h("h3", "Common Questions Answered") +
          questions
            .map(([q, a]) =>
              h("div", h("p", h("strong", escHtml(q))) + h("p", escHtml(a))),
            )
            .join(""),
      );
      break;
    }
    case "comparison": {
      draftContent = `${productTitle} vs alternatives: We focus on quality, transparent pricing, and outstanding support — making ${productTitle} the clear choice for buyers who value reliability and service.`;
      draftHtml = h(
        "div",
        h("h3", `${title} vs. Alternatives`) +
          h("p", escHtml(draftContent)),
      );
      break;
    }
    case "trust": {
      const points = [
        "Thousands of satisfied customers",
        "Secure checkout with buyer protection",
        "Authentic products — no counterfeits",
        "Responsive support team available",
      ];
      draftContent = points.join("\n");
      draftHtml = h("div", h("h3", "Shop with Confidence") + li(points));
      break;
    }
    case "warranty": {
      draftContent = `${productTitle} comes with our standard warranty covering manufacturing defects. Contact us within 12 months of purchase for a replacement or full refund.`;
      draftHtml = h("div", h("h3", "Warranty Information") + h("p", escHtml(draftContent)));
      break;
    }
    case "shipping": {
      draftContent = `Free standard shipping on all orders. Express options available at checkout. Most orders ship within 1–2 business days with full tracking.`;
      draftHtml = h("div", h("h3", "Shipping Information") + h("p", escHtml(draftContent)));
      break;
    }
    case "return": {
      draftContent = `Not satisfied? Return ${productTitle} within 30 days for a full refund — no questions asked. We cover return shipping for defective items.`;
      draftHtml = h("div", h("h3", "Easy Returns") + h("p", escHtml(draftContent)));
      break;
    }
    default: {
      draftContent = `Content for ${productTitle}.`;
      draftHtml = h("p", escHtml(draftContent));
    }
  }

  return {
    sectionType,
    draftContent,
    draftHtml,
    source: "rule",
    characterCount: draftContent.length,
  };
}

/**
 * Build the AI prompt for a product section.
 */
export function buildProductOptimizationPrompt(
  input: ProductOptimizationInput,
): { system: string; user: string } {
  const { productTitle, sectionType, originalContent, storeName } = input;
  const label = SECTION_TYPE_LABELS[sectionType];
  const system = `You are an expert Shopify product copywriter. Return ONLY a JSON object with keys:
- "draftContent": plain text version (no HTML)
- "draftHtml": full HTML snippet (valid, no <html>/<body>)
Never include markdown, code fences, or explanation outside the JSON.`;

  const user = `Optimise the "${label}" section for product: "${productTitle}"
Store name: ${storeName ?? "the store"}
Original content: ${originalContent ? `"${originalContent.slice(0, 500)}"` : "none provided"}
${input.additionalContext ? `Context: ${input.additionalContext}` : ""}

Requirements for ${label}:
${sectionType === "seo_title" ? "- Max 60 characters\n- Include product name and brand" : ""}
${sectionType === "meta_description" ? "- Max 160 characters\n- Include product name and call to action" : ""}
${sectionType === "description" ? "- 150–300 words\n- Benefit-first, SEO-friendly" : ""}
${sectionType === "benefits" ? "- 4–6 bullet points\n- Each under 15 words" : ""}
${sectionType === "objection_handling" ? "- Address 3 common purchase objections\n- Q&A format" : ""}
${["comparison", "trust", "warranty", "shipping", "return"].includes(sectionType) ? "- 50–120 words\n- Clear and reassuring tone" : ""}

Return JSON only.`;

  return { system, user };
}

/**
 * Parse AI JSON response for a product section.
 * Returns null on any parse failure (caller should fall back to rule-based).
 */
export function parseProductOptimizationResponse(
  rawText: string,
  input: ProductOptimizationInput,
): ProductOptimizationResult | null {
  try {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const draftContent = typeof parsed.draftContent === "string" ? parsed.draftContent.trim() : "";
    const draftHtml = typeof parsed.draftHtml === "string" ? parsed.draftHtml.trim() : "";
    if (!draftContent || !draftHtml) return null;

    let finalContent = draftContent;
    if (input.sectionType === "seo_title" && finalContent.length > 60) {
      finalContent = finalContent.slice(0, 57) + "…";
    }
    if (input.sectionType === "meta_description" && finalContent.length > 160) {
      finalContent = finalContent.slice(0, 157) + "…";
    }

    return {
      sectionType: input.sectionType,
      draftContent: finalContent,
      draftHtml,
      source: "ai",
      characterCount: finalContent.length,
    };
  } catch {
    return null;
  }
}

export const PRODUCT_SECTION_TYPES = Object.keys(SECTION_TYPE_LABELS) as ProductSectionType[];
