import type { FaqOpportunityResult, KeywordGroupId, QuestionOpportunity } from "~/lib/types";

const ANSWERS: Partial<Record<KeywordGroupId, string>> = {
  shipping:
    "We show shipping options, delivery estimates, and any free-shipping threshold at checkout before you pay. If your order is time-sensitive, choose the fastest available method.",
  delivery:
    "Delivery timing depends on the shipping method and destination. After your order ships, the tracking page shows the latest carrier updates.",
  return:
    "You can request a return within the return window listed in our policy. Items should be in eligible condition and include the original order details.",
  refund:
    "Refunds are processed after the returned item or claim is reviewed. Once approved, the refund is sent back to the original payment method.",
  stock:
    "If an item is out of stock, use the restock option on the product page or contact support. We will notify you when it becomes available again.",
  size:
    "Check the size guide on the product page before ordering. If you are between sizes, review the fit notes or contact support with your measurements.",
  ingredient:
    "Ingredient details are listed on the product page. If you have allergies or sensitivities, review the full list before purchasing.",
  usage:
    "Usage instructions are included on the product page and packaging. Follow the recommended steps for best results.",
  compare:
    "Our product page explains the main differences in materials, quality, features, and support so you can compare before buying.",
  competitor:
    "We focus on product quality, support, fulfillment reliability, and transparent policies. Review the product details to compare what is included.",
  payment:
    "Available payment methods are shown at checkout. If a payment fails, try another method or contact your bank/payment provider.",
};

export interface GeneratedFaq {
  question: string;
  answer: string;
  topic: string;
  source: "rule" | "ai-ready";
}

export function generateFaqFromOpportunity(
  opportunity: FaqOpportunityResult | QuestionOpportunity,
): GeneratedFaq {
  const groupId = opportunity.groupId;
  const question =
    "question" in opportunity
      ? opportunity.question
      : `What should customers know about ${opportunity.label.toLowerCase()}?`;
  return {
    question,
    answer:
      ANSWERS[groupId] ??
      "Add a concise answer that directly addresses the customer question, sets expectations, and links shoppers to the right product or policy page.",
    topic: groupId,
    source: "rule",
  };
}

export function faqToMarkdown(faq: GeneratedFaq): string {
  return [`## ${faq.question}`, "", faq.answer, ""].join("\n");
}

export function faqToHtml(faq: GeneratedFaq): string {
  return [
    `<section class="customer-insight-faq" data-topic="${faq.topic}">`,
    `<h3>${escapeHtml(faq.question)}</h3>`,
    `<p>${escapeHtml(faq.answer)}</p>`,
    "</section>",
  ].join("");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
