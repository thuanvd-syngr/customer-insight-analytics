import type { AnalysisInput, NormalizedMessage, PageInput, ProductInput } from "~/lib/types";

export function isSampleDataEnabled(env = process.env): boolean {
  return env.ENABLE_SAMPLE_DATA === "true";
}

export const SAMPLE_PRODUCTS: ProductInput[] = [
  {
    id: "sample-1",
    title: "Everyday Matcha Starter Kit",
    handle: "everyday-matcha-starter-kit",
    description: "Ceremonial matcha kit with whisk, scoop, and care instructions.",
  },
  {
    id: "sample-2",
    title: "CloudFit Travel Hoodie",
    handle: "cloudfit-travel-hoodie",
    description: "Lightweight hoodie with a size chart and 30 day returns.",
  },
  {
    id: "sample-3",
    title: "PureGlow Vitamin C Serum",
    handle: "pureglow-vitamin-c-serum",
    description: "Vegan serum with ingredients listed and usage directions.",
  },
];

export const SAMPLE_PAGES: PageInput[] = [
  { title: "Shipping", body: "Free shipping over $75. Standard delivery takes 3-5 days." },
  { title: "Returns", body: "Returns are accepted within 30 days for unused items." },
];

export interface SampleSeed {
  content: string;
  daysAgo: number;
  source: string;
  customerRef?: string;
}

export const SAMPLE_SEEDS: SampleSeed[] = [
  { content: "How much caffeine is in the Everyday Matcha Starter Kit?", daysAgo: 28, source: "chat" },
  { content: "Is the matcha certified organic and lab tested?", daysAgo: 27, source: "email" },
  { content: "Does the CloudFit Travel Hoodie fit true to size?", daysAgo: 26, source: "chat" },
  { content: "I cannot find the size chart for the travel hoodie.", daysAgo: 25, source: "chat" },
  { content: "Is PureGlow Vitamin C Serum vegan and gluten free?", daysAgo: 24, source: "email" },
  { content: "Where is the serum made and where are ingredients sourced?", daysAgo: 23, source: "chat" },
  { content: "Do you ship to Canada and are duties included?", daysAgo: 22, source: "chat" },
  { content: "Amazon has a similar matcha kit cheaper, what is the difference?", daysAgo: 21, source: "chat" },
  { content: "Can I pay with PayPal or Klarna at checkout?", daysAgo: 20, source: "email" },
  { content: "My payment failed twice with a credit card checkout error.", daysAgo: 19, source: "chat" },
  { content: "When will the CloudFit hoodie be back in stock?", daysAgo: 18, source: "chat" },
  { content: "The large hoodie is sold out, can I preorder?", daysAgo: 17, source: "email" },
  { content: "Do you have a student discount or promo code?", daysAgo: 16, source: "chat" },
  { content: "Is there a warranty if the whisk arrives broken?", daysAgo: 15, source: "email" },
  { content: "How do I use the serum with sunscreen?", daysAgo: 14, source: "chat" },
  { content: "How often should I wash the hoodie?", daysAgo: 13, source: "chat" },
  { content: "Is the matcha kit better than the one from Etsy?", daysAgo: 12, source: "chat" },
  { content: "What is the return policy if the hoodie doesn't fit?", daysAgo: 11, source: "email" },
  { content: "I want a refund because the package is still waiting in transit.", daysAgo: 10, source: "email" },
  { content: "My order is late and tracking number has not updated.", daysAgo: 6, source: "chat" },
  { content: "Delivery was delayed again, how many days should I wait?", daysAgo: 6, source: "email" },
  { content: "Shipping cost looks high for the matcha kit.", daysAgo: 5, source: "chat" },
  { content: "Can I return the hoodie because it is too small?", daysAgo: 5, source: "chat" },
  { content: "Need a refund, the serum arrived damaged.", daysAgo: 4, source: "email" },
  { content: "Tracking number says delayed and I may cancel my order.", daysAgo: 4, source: "chat" },
  { content: "The serum is out of stock, when is restock?", daysAgo: 3, source: "chat" },
  { content: "Payment failed with Afterpay during checkout.", daysAgo: 3, source: "chat" },
  { content: "Return policy is unclear for sale items.", daysAgo: 2, source: "email" },
  { content: "Shipping fee changed at checkout.", daysAgo: 2, source: "chat" },
  { content: "I found it cheaper on Temu, is yours genuine?", daysAgo: 1, source: "chat" },
  { content: "Please refund my order, delivery is late again.", daysAgo: 1, source: "email" },
  { content: "Can I exchange the CloudFit hoodie for a bigger size?", daysAgo: 0, source: "chat" },
  { content: "Is PureGlow safe for allergens and sensitive skin?", daysAgo: 0, source: "chat" },
  { content: "Do you offer free shipping if I buy two kits?", daysAgo: 0, source: "chat" },
  { content: "The checkout error says payment cannot be processed.", daysAgo: 0, source: "chat" },
  { content: "How does PureGlow compare versus other vitamin C serums?", daysAgo: 8, source: "chat" },
  { content: "Can you guarantee the hoodie zipper if it becomes faulty?", daysAgo: 9, source: "email" },
  { content: "Is the matcha imported from Japan?", daysAgo: 7, source: "chat" },
  { content: "Do you have cash on delivery?", daysAgo: 6, source: "chat" },
  { content: "Can I get a coupon code for my first order?", daysAgo: 5, source: "chat" },
  { content: "The product page does not say how strong the serum is.", daysAgo: 4, source: "chat" },
  { content: "Does the hoodie material contain wool?", daysAgo: 3, source: "email" },
  { content: "Which is better, CloudFit or another brand for travel?", daysAgo: 2, source: "chat" },
  { content: "Is there international shipping for the serum?", daysAgo: 1, source: "chat" },
  { content: "Can I send back an opened matcha kit?", daysAgo: 0, source: "email" },
];

export function getSampleExternalId(index: number): string {
  return `sample-seed-${index + 1}`;
}

export function getSampleMessages(now: Date): NormalizedMessage[] {
  return SAMPLE_SEEDS.map((seed, index) => ({
    id: `sample-${index + 1}`,
    content: seed.content,
    occurredAt: new Date(now.getTime() - seed.daysAgo * 86_400_000),
    source: seed.source,
    customerRef: seed.customerRef ?? null,
    externalId: getSampleExternalId(index),
  }));
}

export function filterNewSampleMessages(
  messages: NormalizedMessage[],
  existingExternalIds: Iterable<string | null>,
): NormalizedMessage[] {
  const existing = new Set([...existingExternalIds].filter(Boolean));
  return messages.filter(
    (message) => !message.externalId || !existing.has(message.externalId),
  );
}

export function buildSampleAnalysisInput(now = new Date()): AnalysisInput {
  return {
    messages: getSampleMessages(now),
    products: SAMPLE_PRODUCTS,
    pages: SAMPLE_PAGES,
    now,
    windowDays: 30,
  };
}
