import { DEFAULT_FAQS, PAGE_TYPE_GROUPS, PAGE_TYPE_LABELS, type FaqItem, type PageContentType } from "~/lib/publish";
import type { InsightResult, KeywordGroupId, LeakageSeverity } from "~/lib/types";

export type RecoveryActionKind =
  | "faq_draft"
  | "page_draft"
  | "publish_pages"
  | "publish_widget"
  | "product_faq"
  | "theme_audit"
  | "content_pack";

export interface RecoveryAction {
  id: string;
  label: string;
  kind: RecoveryActionKind;
  targetUrl: string;
  groupId?: KeywordGroupId;
  pageType?: PageContentType;
  completed: boolean;
}

export interface RecoveryPlanIssue {
  id: string;
  title: string;
  severity: LeakageSeverity;
  estimatedImpact: number;
  mentionCount: number;
  actions: RecoveryAction[];
}

export interface RecoveryPlan {
  revenueAtRisk: number;
  expectedRecoveryLow: number;
  expectedRecoveryHigh: number;
  topIssues: RecoveryPlanIssue[];
  completedActions: number;
  totalActions: number;
}

export interface RecoveryScoreFactors {
  questionsAnswered: number;
  publishedAssets: number;
  missingContentCount: number;
  faqCoverage: number;
  competitorCoverage: number;
}

export interface RecoveryScoreImprovement {
  currentScore: number;
  potentialScore: number;
  factors: RecoveryScoreFactors;
}

export interface PublishedCountsLike {
  total: number;
  pages: number;
  blogs: number;
  productFaqs: number;
}

export interface GeneratedFaqLike {
  groupId: string | null;
  status: string;
  productId?: string | null;
}

const GROUP_PAGE_TYPES: Partial<Record<KeywordGroupId, PageContentType>> = {
  shipping: "shipping_page",
  delivery: "shipping_page",
  return: "return_page",
  refund: "return_page",
  payment: "payment_page",
  warranty: "warranty_page",
  size: "warranty_page",
  usage: "warranty_page",
  ingredient: "warranty_page",
  discount: "discount_page",
};

function titleForGroup(groupId: KeywordGroupId, fallback: string): string {
  const labels: Partial<Record<KeywordGroupId, string>> = {
    shipping: "Shipping Questions",
    delivery: "Delivery Timeline Questions",
    return: "Return Policy Questions",
    refund: "Refund Questions",
    payment: "Payment Questions",
    warranty: "Warranty Questions",
    size: "Size and Fit Questions",
    compare: "Comparison Questions",
    competitor: "Competitor Questions",
  };
  return labels[groupId] ?? fallback;
}

function isGroupCompleted(groupId: KeywordGroupId, generatedFaqs: GeneratedFaqLike[]): boolean {
  return generatedFaqs.some((faq) => faq.groupId === groupId && ["generated", "draft", "prepared", "published"].includes(faq.status));
}

function completedPage(pageType: PageContentType, counts: PublishedCountsLike): boolean {
  if (pageType === "faq_page") return counts.pages > 0;
  return false;
}

export function buildRecoveryPlan(input: {
  insight: InsightResult;
  publishedCounts: PublishedCountsLike;
  generatedFaqs?: GeneratedFaqLike[];
}): RecoveryPlan {
  const generatedFaqs = input.generatedFaqs ?? [];
  const source = input.insight.questionOpportunities.length
    ? input.insight.questionOpportunities
    : input.insight.revenueOpportunity.drivers.map((driver) => ({
        groupId: driver.groupId,
        label: driver.label,
        count: driver.count,
        severity: driver.priorityScore >= 70 ? "high" as const : driver.priorityScore >= 40 ? "medium" as const : "low" as const,
        lowEstimate: driver.lowEstimate,
        highEstimate: driver.highEstimate,
        priorityScore: driver.priorityScore,
      }));

  const issues = source
    .slice()
    .sort((a, b) => b.priorityScore - a.priorityScore || b.highEstimate - a.highEstimate)
    .slice(0, 3)
    .map((item): RecoveryPlanIssue => {
      const pageType = GROUP_PAGE_TYPES[item.groupId] ?? "faq_page";
      const actions: RecoveryAction[] = [
        {
          id: `${item.groupId}-faq`,
          label: `Create ${titleForGroup(item.groupId, item.label).replace(" Questions", "")} FAQ`,
          kind: "faq_draft",
          targetUrl: `/app/faq?group=${item.groupId}`,
          groupId: item.groupId,
          completed: isGroupCompleted(item.groupId, generatedFaqs),
        },
        {
          id: `${item.groupId}-page`,
          label: `Create ${PAGE_TYPE_LABELS[pageType]}`,
          kind: "page_draft",
          targetUrl: "/app/recovery",
          groupId: item.groupId,
          pageType,
          completed: completedPage(pageType, input.publishedCounts),
        },
        {
          id: `${item.groupId}-publish`,
          label: item.groupId === "shipping" ? "Publish FAQ Widget" : "Publish Recovery Content",
          kind: item.groupId === "shipping" ? "publish_widget" : "publish_pages",
          targetUrl: item.groupId === "shipping" ? "/app/widget" : "/app/publish",
          groupId: item.groupId,
          pageType,
          completed: input.publishedCounts.total > 0,
        },
      ];
      return {
        id: item.groupId,
        title: titleForGroup(item.groupId, item.label),
        severity: item.severity,
        estimatedImpact: Math.round(item.highEstimate || item.lowEstimate),
        mentionCount: item.count,
        actions,
      };
    });

  const revenueAtRisk = Math.round(input.insight.revenueOpportunity.monthlyAtRisk || input.insight.revenueOpportunity.estimatedHigh);
  const expectedRecoveryLow = issues.reduce((sum, issue) => sum + Math.round(issue.estimatedImpact * 0.45), 0);
  const expectedRecoveryHigh = issues.reduce((sum, issue) => sum + issue.estimatedImpact, 0);
  const allActions = issues.flatMap((issue) => issue.actions);
  return {
    revenueAtRisk,
    expectedRecoveryLow,
    expectedRecoveryHigh,
    topIssues: issues,
    completedActions: allActions.filter((action) => action.completed).length,
    totalActions: allActions.length,
  };
}

export function calculateRecoveryScoreImprovement(input: {
  insight: InsightResult;
  publishedCounts: PublishedCountsLike;
  generatedFaqs?: GeneratedFaqLike[];
}): RecoveryScoreImprovement {
  const generatedFaqs = input.generatedFaqs ?? [];
  const openFaqs = input.insight.faqOpportunities.filter((faq) => !faq.hasContent);
  const answeredGroups = new Set(generatedFaqs.filter((faq) => ["generated", "draft", "prepared", "published"].includes(faq.status)).map((faq) => faq.groupId).filter(Boolean));
  const relevantGroups = new Set(input.insight.questionOpportunities.map((item) => item.groupId));
  const faqCoverage = relevantGroups.size === 0 ? 0 : Math.round((answeredGroups.size / relevantGroups.size) * 100);
  const missingContentCount = openFaqs.length + input.insight.contentGaps.reduce((sum, gap) => sum + gap.missingSections.length, 0);
  const competitorCoverage = input.insight.competitorThreats.length === 0
    ? 100
    : Math.min(100, Math.round((input.publishedCounts.blogs / input.insight.competitorThreats.length) * 100));
  const factors: RecoveryScoreFactors = {
    questionsAnswered: answeredGroups.size,
    publishedAssets: input.publishedCounts.total,
    missingContentCount,
    faqCoverage,
    competitorCoverage,
  };
  const improvement =
    Math.min(18, factors.questionsAnswered * 4) +
    Math.min(16, factors.publishedAssets * 3) +
    Math.min(18, Math.max(0, missingContentCount) * 2) +
    Math.round(faqCoverage * 0.18) +
    Math.round(competitorCoverage * 0.08);
  return {
    currentScore: input.insight.insightScore,
    potentialScore: Math.max(input.insight.insightScore, Math.min(100, input.insight.insightScore + improvement)),
    factors,
  };
}

export interface ThemeAuditIssue {
  id: string;
  issue: string;
  impact: string;
  recommendedFix: string;
  groupId?: KeywordGroupId;
  severity: LeakageSeverity;
  estimatedImpact: number;
}

export function scanThemeContent(input: {
  themeText: string;
  insight: InsightResult;
}): ThemeAuditIssue[] {
  const text = input.themeText.toLowerCase();
  const atRisk = input.insight.revenueOpportunity.monthlyAtRisk || input.insight.revenueOpportunity.estimatedHigh || 0;
  const checks: Array<{ id: string; terms: RegExp; issue: string; fix: string; groupId?: KeywordGroupId; weight: number }> = [
    { id: "faq", terms: /faq|frequently asked|question/i, issue: "Missing FAQ section", fix: "Publish an FAQ page and add the FAQ widget to product pages.", groupId: "shipping", weight: 0.22 },
    { id: "shipping", terms: /shipping|delivery|track/i, issue: "Missing shipping information", fix: "Publish a shipping information page with delivery timelines.", groupId: "shipping", weight: 0.2 },
    { id: "return", terms: /return|refund|exchange/i, issue: "Missing return policy", fix: "Publish a return and refund policy page.", groupId: "return", weight: 0.18 },
    { id: "trust", terms: /review|secure|guarantee|trust|verified/i, issue: "Missing trust section", fix: "Add reviews, guarantees, and checkout security copy near buying actions.", weight: 0.14 },
    { id: "warranty", terms: /warranty|guarantee|coverage/i, issue: "Missing warranty information", fix: "Publish a warranty page and link it from product pages.", groupId: "warranty", weight: 0.12 },
    { id: "buying-guide", terms: /guide|compare|how to choose|size chart|sizing/i, issue: "Missing buying guide", fix: "Install a buying guide content pack for top products.", groupId: "compare", weight: 0.1 },
  ];
  return checks
    .filter((check) => !check.terms.test(text))
    .map((check) => {
      const estimatedImpact = atRisk > 0 ? Math.max(50, Math.round(atRisk * check.weight)) : 0;
      return {
        id: check.id,
        issue: check.issue,
        impact: estimatedImpact > 0
          ? `$${estimatedImpact}/mo estimated revenue at risk`
          : "Content coverage issue",
        recommendedFix: check.fix,
        groupId: check.groupId,
        severity: estimatedImpact >= 350 ? "high" : estimatedImpact >= 150 ? "medium" : "low",
        estimatedImpact,
      };
    });
}

export interface ContentPack {
  id: string;
  title: string;
  groupId: KeywordGroupId;
  pageType: PageContentType;
  faqs: FaqItem[];
  schemaType: "FAQPage";
  suggestedPublishTargets: string[];
}

export const CONTENT_PACKS: ContentPack[] = [
  { id: "shipping", title: "Shipping Pack", groupId: "shipping", pageType: "shipping_page", faqs: DEFAULT_FAQS.shipping, schemaType: "FAQPage", suggestedPublishTargets: ["Shipping page", "FAQ widget", "Product FAQ"] },
  { id: "refund", title: "Refund Pack", groupId: "refund", pageType: "return_page", faqs: DEFAULT_FAQS.refund, schemaType: "FAQPage", suggestedPublishTargets: ["Return page", "FAQ page"] },
  { id: "warranty", title: "Warranty Pack", groupId: "warranty", pageType: "warranty_page", faqs: DEFAULT_FAQS.warranty ?? DEFAULT_FAQS.usage, schemaType: "FAQPage", suggestedPublishTargets: ["Warranty page", "Product FAQ"] },
  { id: "payment", title: "Payment Pack", groupId: "payment", pageType: "payment_page", faqs: DEFAULT_FAQS.payment, schemaType: "FAQPage", suggestedPublishTargets: ["Payment page", "FAQ page"] },
  { id: "holiday", title: "Holiday Sales Pack", groupId: "discount", pageType: "discount_page", faqs: [...(DEFAULT_FAQS.discount ?? DEFAULT_FAQS.stock), ...DEFAULT_FAQS.shipping].slice(0, 5), schemaType: "FAQPage", suggestedPublishTargets: ["Promotions page", "Blog article", "FAQ page"] },
];

export type RevenueTimelineV2Type =
  | "content_created"
  | "content_published"
  | "pages_published"
  | "products_fixed"
  | "revenue_recovered";

export interface RevenueTimelineV2Card {
  type: RevenueTimelineV2Type;
  label: string;
  count: number;
  lowEstimate: number;
  highEstimate: number;
}

export function buildRevenueTimelineV2(input: {
  generatedFaqs?: GeneratedFaqLike[];
  publishedCounts: PublishedCountsLike;
  plan: RecoveryPlan;
}): RevenueTimelineV2Card[] {
  const created = input.generatedFaqs?.filter((faq) => ["generated", "draft", "prepared", "published"].includes(faq.status)).length ?? 0;
  const productFaqs = input.generatedFaqs?.filter((faq) => faq.productId && faq.status === "published").length ?? input.publishedCounts.productFaqs;
  return [
    { type: "content_created", label: "Content Created", count: created, lowEstimate: created * 40, highEstimate: created * 120 },
    { type: "content_published", label: "Content Published", count: input.publishedCounts.total, lowEstimate: input.publishedCounts.total * 75, highEstimate: input.publishedCounts.total * 250 },
    { type: "pages_published", label: "Pages Published", count: input.publishedCounts.pages, lowEstimate: input.publishedCounts.pages * 100, highEstimate: input.publishedCounts.pages * 350 },
    { type: "products_fixed", label: "Products Fixed", count: productFaqs, lowEstimate: productFaqs * 60, highEstimate: productFaqs * 180 },
    { type: "revenue_recovered", label: "Revenue Recovered", count: input.publishedCounts.total + productFaqs, lowEstimate: input.plan.expectedRecoveryLow, highEstimate: input.plan.expectedRecoveryHigh },
  ];
}

export interface AppStoreAuditItem {
  route: string;
  risk: string;
  recommendedFix: string;
}

export const APP_STORE_READINESS_AUDIT: AppStoreAuditItem[] = [
  { route: "/app/recovery", risk: "Blank store must show sample recovery plan and clear Sample Data label.", recommendedFix: "Reviewer Mode V2 overlay enabled in loader without DB writes." },
  { route: "/app/theme-audit", risk: "Theme scan cannot fail into an Application Error when theme access is unavailable.", recommendedFix: "Provide fallback scan from available Shopify content and a manual rescan CTA." },
  { route: "/app/publish", risk: "Bulk publish requires preview and confirmation before live Shopify writes.", recommendedFix: "Publish All Recovery Content uses a visible preview and confirm form." },
  { route: "/app/faq", risk: "Draft generation must never auto-publish.", recommendedFix: "One-click recovery stores drafts only." },
  { route: "/app/widget", risk: "Widget CTA should appear only when recovery value is demonstrated.", recommendedFix: "Route from recovery plan after revenue at risk is visible." },
];
