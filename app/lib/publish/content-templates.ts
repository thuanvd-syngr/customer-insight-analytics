export type PageContentType =
  | "faq_page"
  | "shipping_page"
  | "return_page"
  | "warranty_page"
  | "payment_page"
  | "discount_page";

export interface FaqItem {
  question: string;
  answer: string;
}

export interface PageTemplate {
  title: string;
  handle: string;
  bodyHtml: string;
}

export interface ArticleTemplate {
  title: string;
  handle: string;
  bodyHtml: string;
  summary: string;
}

export const PAGE_TYPE_LABELS: Record<PageContentType, string> = {
  faq_page: "FAQ Page",
  shipping_page: "Shipping Info Page",
  return_page: "Return & Refund Policy",
  warranty_page: "Warranty Page",
  payment_page: "Payment Methods Page",
  discount_page: "Discounts & Promotions Page",
};

export const PAGE_TYPE_DESCRIPTIONS: Record<PageContentType, string> = {
  faq_page: "All your most-asked questions in one place. Reduces support volume.",
  shipping_page: "Shipping times, costs, tracking. Eliminates pre-purchase hesitation.",
  return_page: "Clear return & refund policy. Converts hesitant buyers.",
  warranty_page: "Product warranty details. Builds buyer confidence.",
  payment_page: "Accepted methods and checkout security. Removes checkout friction.",
  discount_page: "How to apply codes and find deals. Improves coupon conversion.",
};

export const PAGE_TYPE_GROUPS: Record<PageContentType, string[]> = {
  faq_page: ["shipping", "delivery", "return", "refund", "payment", "stock"],
  shipping_page: ["shipping", "delivery"],
  return_page: ["return", "refund"],
  warranty_page: ["size", "ingredient", "usage"],
  payment_page: ["payment"],
  discount_page: ["stock", "compare"],
};

export const ALL_PAGE_CONTENT_TYPES: PageContentType[] = [
  "faq_page",
  "shipping_page",
  "return_page",
  "warranty_page",
  "payment_page",
  "discount_page",
];

export const BLOG_GROUP_LABELS: Record<string, string> = {
  shipping: "Shipping & Delivery",
  return: "Returns & Refunds",
  payment: "Payment & Checkout",
  size: "Sizing & Fit",
  ingredient: "Ingredients & Materials",
  usage: "Product Usage",
  compare: "Product Comparisons",
  stock: "Stock & Availability",
};

// Default FAQ content per group, used when no insight data is available.
export const DEFAULT_FAQS: Record<string, FaqItem[]> = {
  shipping: [
    {
      question: "How long does shipping take?",
      answer:
        "Shipping times vary by method and destination. Available options and estimated delivery dates are shown at checkout before you pay.",
    },
    {
      question: "Do you offer free shipping?",
      answer:
        "Free shipping thresholds are displayed at checkout when applicable. Add items to your cart to see available shipping promotions.",
    },
    {
      question: "How do I track my order?",
      answer:
        "A tracking number is emailed after your order ships. Use it on the carrier's website or the tracking link in your confirmation email.",
    },
  ],
  delivery: [
    {
      question: "When will my order arrive?",
      answer:
        "Estimated delivery dates are shown at checkout. After shipping, your tracking page shows live carrier updates.",
    },
    {
      question: "Do you ship internationally?",
      answer:
        "International shipping availability and rates are shown during checkout based on your delivery address.",
    },
  ],
  return: [
    {
      question: "What is your return policy?",
      answer:
        "Returns are accepted within the window stated in our policy. Items must be in eligible condition with original order details included.",
    },
    {
      question: "How do I start a return?",
      answer:
        "Visit your order history or contact our support team to initiate a return. We will provide a return label or instructions.",
    },
  ],
  refund: [
    {
      question: "When will I receive my refund?",
      answer:
        "Refunds are processed once the returned item is received and reviewed. Funds are returned to the original payment method, typically within 5–10 business days.",
    },
    {
      question: "Can I exchange instead of returning?",
      answer:
        "Exchanges are available on eligible items. Contact support to arrange an exchange before initiating a return.",
    },
  ],
  payment: [
    {
      question: "What payment methods do you accept?",
      answer:
        "All available payment methods are shown at checkout. We accept major credit and debit cards and may offer additional options depending on your location.",
    },
    {
      question: "Is checkout secure?",
      answer:
        "Yes. Checkout is protected with industry-standard SSL encryption. Your payment details are never stored on our servers.",
    },
  ],
  stock: [
    {
      question: "What if an item is out of stock?",
      answer:
        "Use the restock notification option on the product page to be alerted when inventory returns. You can also contact support to check availability.",
    },
    {
      question: "Can I pre-order out-of-stock items?",
      answer:
        "Pre-order availability is shown on the product page when offered. Contact support if you need a specific item urgently.",
    },
  ],
  size: [
    {
      question: "How do I find the right size?",
      answer:
        "A size guide is available on each product page. If you are between sizes, review the fit notes or contact support with your measurements.",
    },
  ],
  ingredient: [
    {
      question: "What are the ingredients?",
      answer:
        "Full ingredient lists are on each product page. Review them carefully if you have allergies or sensitivities before purchasing.",
    },
  ],
  usage: [
    {
      question: "How do I use this product?",
      answer:
        "Usage instructions are included on the product page and in the packaging. Follow the recommended steps for best results.",
    },
  ],
  compare: [
    {
      question: "How does your product compare to competitors?",
      answer:
        "Our product page covers materials, quality, features, and support. Review the details to compare before buying.",
    },
  ],
};

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeJsonLd(obj: unknown): string {
  // Escape characters that are unsafe inside a <script> tag in HTML context.
  // < / > prevent </script> injection and are valid JSON unicode escapes.
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function buildFaqSchema(items: FaqItem[]): string {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
  return `<script type="application/ld+json">${safeJsonLd(schema)}</script>`;
}

function buildFaqItemsHtml(items: FaqItem[]): string {
  return items
    .map(
      (item) =>
        `<details class="cia-faq-item">\n  <summary class="cia-faq-q"><strong>${esc(item.question)}</strong></summary>\n  <div class="cia-faq-a"><p>${esc(item.answer)}</p></div>\n</details>`,
    )
    .join("\n");
}

const PAGE_META: Record<PageContentType, { title: string; handle: string; intro: string }> = {
  faq_page: {
    title: "Frequently Asked Questions",
    handle: "faq",
    intro: "Find clear answers to our most common customer questions.",
  },
  shipping_page: {
    title: "Shipping Information & Delivery Times",
    handle: "shipping-information",
    intro: "Everything you need to know about shipping options, delivery times, and order tracking.",
  },
  return_page: {
    title: "Return & Refund Policy",
    handle: "return-refund-policy",
    intro: "Our straightforward return and refund policy — no surprises.",
  },
  warranty_page: {
    title: "Product Warranty",
    handle: "product-warranty",
    intro: "Our product warranty terms and how to make a warranty claim.",
  },
  payment_page: {
    title: "Payment Methods & Checkout Security",
    handle: "payment-methods",
    intro: "Accepted payment methods and how we keep your checkout secure.",
  },
  discount_page: {
    title: "Discount Codes & Promotions",
    handle: "discount-codes-promotions",
    intro: "How to use discount codes and where to find our best deals.",
  },
};

export function buildPageContent(type: PageContentType, faqs: FaqItem[]): PageTemplate {
  const meta = PAGE_META[type];
  const parts: string[] = [
    `<h1>${esc(meta.title)}</h1>`,
    `<p>${esc(meta.intro)}</p>`,
  ];
  if (faqs.length > 0) {
    parts.push(buildFaqItemsHtml(faqs));
    parts.push(buildFaqSchema(faqs));
  }
  return { title: meta.title, handle: meta.handle, bodyHtml: parts.join("\n") };
}

export function buildArticleContent(
  groupId: string,
  faqs: FaqItem[],
  storeName = "our store",
): ArticleTemplate {
  const label = (BLOG_GROUP_LABELS[groupId] ?? groupId).replace(/_/g, " ");
  const title = `${label}: Your Questions Answered`;
  const handle = `${groupId.replace(/_/g, "-")}-guide`;
  const summary = `Answers to the most common ${label.toLowerCase()} questions from our customers.`;
  const parts: string[] = [
    `<p>Customers at ${esc(storeName)} regularly ask us about ${esc(label.toLowerCase())}. Here are the answers to the questions we see most often.</p>`,
  ];
  if (faqs.length > 0) {
    parts.push(buildFaqItemsHtml(faqs));
    parts.push(buildFaqSchema(faqs));
  }
  parts.push(
    `<hr/><p><a href="/">Browse ${esc(storeName)}</a> or <a href="/pages/contact">contact us</a> if you have more questions.</p>`,
  );
  return { title, handle, bodyHtml: parts.join("\n"), summary };
}

export function faqsForPageType(type: PageContentType, insightFaqs: FaqItem[]): FaqItem[] {
  if (insightFaqs.length > 0) return insightFaqs.slice(0, 8);
  const groups = PAGE_TYPE_GROUPS[type];
  return groups.flatMap((g) => DEFAULT_FAQS[g] ?? []).slice(0, 8);
}
