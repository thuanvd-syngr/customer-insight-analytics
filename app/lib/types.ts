// Shared domain contracts for Customer Insight Analytics.
// Every engine module, AI provider, and UI route builds against these types.
// Treat this file as the source of truth — do not fork these shapes.

/** The 16 friction keyword groups the rule-based engine tracks. */
export type KeywordGroupId =
  | "shipping"
  | "return"
  | "refund"
  | "size"
  | "ingredient"
  | "origin"
  | "stock"
  | "discount"
  | "warranty"
  | "delivery"
  | "payment"
  | "certificate"
  | "caffeine"
  | "usage"
  | "compare"
  | "competitor";

/** Definition of one keyword group (configured in app/lib/engine/keyword-groups.ts). */
export interface KeywordGroup {
  id: KeywordGroupId;
  /** Human label shown in the UI. */
  label: string;
  /** A short, merchant-facing question template this group maps to. */
  question: string;
  /** Lowercase keywords/phrases that map a message into this group. */
  terms: string[];
  /** 0..1 — how strongly this group signals purchase friction. */
  frictionWeight: number;
  /** When true, a sharp rise in this group feeds the revenue-leakage detector. */
  leakageRisk: boolean;
}

/** A normalized message ready for analysis (DB-agnostic). */
export interface NormalizedMessage {
  id: string;
  content: string;
  occurredAt: Date;
  source: string;
  customerRef?: string | null;
  externalId?: string | null;
}

/** A product the engine can match mentions against. */
export interface ProductInput {
  /** Shopify GID, or null for CSV/manual products. */
  id: string | null;
  title: string;
  description?: string;
  handle?: string;
}

/** Existing store content (e.g. FAQ pages from read_content) used to detect coverage gaps. */
export interface PageInput {
  title: string;
  body: string;
}

/** Input bundle for a full analysis pass. */
export interface AnalysisInput {
  messages: NormalizedMessage[];
  products: ProductInput[];
  pages?: PageInput[];
  /** Inject "now" for deterministic tests. Defaults to new Date(). */
  now?: Date;
  /** Primary analysis window in days. Defaults to 30. */
  windowDays?: number;
}

/** A single keyword match inside a message (intermediate, not persisted as-is). */
export interface KeywordHit {
  groupId: KeywordGroupId;
  keyword: string;
  messageId: string;
  occurredAt: Date;
}

/** Aggregated result for one keyword group across the analyzed window. */
export interface KeywordGroupResult {
  groupId: KeywordGroupId;
  label: string;
  count: number;
  /** Number of distinct messages that hit this group. */
  uniqueMessages: number;
  /** Top representative keywords with their raw counts. */
  keywords: Array<{ keyword: string; count: number }>;
  /** Percent change vs the previous 7-day window (e.g. 0.5 === +50%). */
  trend7: number;
  /** Percent change vs the previous 30-day window. */
  trend30: number;
  frictionWeight: number;
  exampleQuote?: string;
}

/** A product customers are confused about. */
export interface ProductConfusionResult {
  productId: string | null;
  productTitle: string;
  mentionCount: number;
  /** 0..100 confusion score (mentions weighted by friction of co-occurring groups). */
  confusionScore: number;
  topGroups: KeywordGroupId[];
  exampleQuote?: string;
}

/** A suggested FAQ entry the store appears to be missing. */
export interface FaqOpportunityResult {
  groupId: KeywordGroupId;
  question: string;
  rationale: string;
  frequency: number;
  /** True when existing product/page content already covers this topic. */
  hasContent: boolean;
  /** 0..100 priority. Higher = bigger gap between demand and coverage. */
  priority: number;
  productId?: string | null;
}

/** A detected competitor mention. */
export interface CompetitorMentionResult {
  name: string;
  count: number;
  exampleQuote?: string;
}

export type LeakageSeverity = "low" | "medium" | "high";

/** A revenue-leakage alert: a friction group rising sharply. */
export interface RevenueLeakageAlert {
  groupId: KeywordGroupId;
  label: string;
  severity: LeakageSeverity;
  count: number;
  trend7: number;
  /** Merchant-facing one-liner explaining the alert. */
  message: string;
}

/** A point on the daily message-volume trend line. */
export interface TrendPoint {
  /** ISO date, yyyy-mm-dd. */
  date: string;
  count: number;
}

/** A top customer question surfaced for the dashboard. */
export interface TopQuestion {
  text: string;
  count: number;
  groupId: KeywordGroupId | null;
}

/** The full output of one analysis pass. Persisted as InsightRun.summaryJson. */
export interface InsightResult {
  /** 0..100. Higher = healthier (less unresolved friction). */
  insightScore: number;
  windowDays: number;
  messageCount: number;
  /** ISO timestamp the analysis was generated. */
  generatedAt: string;
  topQuestions: TopQuestion[];
  /** Friction keyword groups, sorted by impact (count * frictionWeight). */
  keywordGroups: KeywordGroupResult[];
  productConfusion: ProductConfusionResult[];
  faqOpportunities: FaqOpportunityResult[];
  competitors: CompetitorMentionResult[];
  revenueLeakage: RevenueLeakageAlert[];
  /** Daily volume for the trend chart (oldest -> newest). */
  weeklyTrend: TrendPoint[];
}

/** Empty/zero-value result used for empty states and as a safe default. */
export const EMPTY_INSIGHT: InsightResult = {
  insightScore: 0,
  windowDays: 30,
  messageCount: 0,
  generatedAt: "",
  topQuestions: [],
  keywordGroups: [],
  productConfusion: [],
  faqOpportunities: [],
  competitors: [],
  revenueLeakage: [],
  weeklyTrend: [],
};
