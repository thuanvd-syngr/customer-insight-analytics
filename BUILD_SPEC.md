# BUILD SPEC — Customer Insight Analytics (internal contract for build agents)

> This file is the single source of truth for module boundaries and function
> signatures. Build strictly against it. Do **not** invent different shapes.
> (This file is a build artifact; it may be deleted before shipping.)

## Product
Shopify **embedded** app. Positioning: "Find why customers don't buy."
A rule-based Customer Insight Analytics dashboard (NOT a chatbot). Optional
batch AI weekly summaries. Cheap to run, deployable to Google Cloud Run.

## Tech stack (DO NOT change versions or add deps)
- Remix 2.17 (Vite 6) + React 18 + TypeScript (strict).
- `@shopify/shopify-app-remix` v4, `@shopify/polaris` v13, `@shopify/app-bridge-react` v4.
- Prisma 6.19 + PostgreSQL.
- Vitest 4 for tests.
- Path alias `~/*` → `app/*`. Server-only files end in `.server.ts`.

## HARD RULES for every agent
1. **Only create the files assigned to you.** Never edit or overwrite files
   owned by the spine or another agent.
2. **Read these spine files first** (already written, authoritative — import from them):
   - `app/lib/types.ts` — all domain types + `EMPTY_INSIGHT`.
   - `app/lib/engine/keyword-groups.ts` — `KEYWORD_GROUPS`, `KEYWORD_GROUPS_BY_ID`, `DEFAULT_COMPETITOR_TERMS`, `LEAKAGE_GROUP_IDS`.
   - `app/lib/billing/plans.ts` — `PLANS`, `PlanId`, `PLAN_IDS`, `PAID_PLAN_IDS`, `PAID_PLAN_NAMES`, `BILLING_CONFIG`, `planIdFromName`, `getPlan`.
   - `app/lib/shop.server.ts` — `ensureShop`, `getShopByDomain`, `setShopPlan`, `markOnboarded`, `getLatestRun`, `getRecentRuns`, `parseRun`, `saveInsightRun`, `cleanupShop`.
   - `app/shopify.server.ts` — default export `shopify`; named: `authenticate`, `login`, `unauthenticated`, `registerWebhooks`, `sessionStorage`, `addDocumentResponseHeaders`, `apiVersion`.
   - `app/db.server.ts` — default export `prisma` (PrismaClient).
   - `prisma/schema.prisma` — model field names (use them exactly).
3. Keep files small and focused. Match the existing code style (2-space indent,
   named exports, JSDoc on exported functions).
4. Engine + AI + gating logic must be **pure and deterministic** (accept `now: Date`
   where time matters). No `Date.now()` inside pure functions — take `now` as a param.
5. Routes are thin: they call `authenticate.admin(request)`, then delegate to
   `app/lib/*`. Business logic lives in `app/lib`, not in routes.

## Remix conventions (follow exactly)
- Import data helpers from `@remix-run/node`: `json`, `redirect`, `type LoaderFunctionArgs`, `type ActionFunctionArgs`.
- Import UI/runtime from `@remix-run/react`: `useLoaderData`, `useActionData`, `Form`, `useNavigation`, `useSubmit`, `Link`, `useRouteError`, `useFetcher`.
- Loaders/actions return `json(...)` (single-fetch is OFF). Type loader data with `useLoaderData<typeof loader>()`.
- Polaris components imported from `@shopify/polaris` (e.g. `Page, Layout, Card, BlockStack, InlineStack, InlineGrid, Text, Button, Badge, Banner, EmptyState, DataTable, IndexTable, ProgressBar, Box, Divider, List, Select, TextField, Spinner, Tabs, CalloutCard, MediaCard, Link as PolarisLink`).
- `NavMenu` is imported from `@shopify/app-bridge-react`.
- Embedded boundary helpers: `import { boundary } from "@shopify/shopify-app-remix/server"`.
- Get shop domain in a route: `const { session } = await authenticate.admin(request); const shopDomain = session.shop;`
- Get the GraphQL client: `const { admin } = await authenticate.admin(request);` then pass `admin` to `collectShopData(admin, ...)`.
- Billing: `const { billing } = await authenticate.admin(request); await billing.check({ plans: PAID_PLAN_NAMES, isTest })` → `{ hasActivePayment, appSubscriptions }`. `await billing.request({ plan, isTest, returnUrl })`.

---

# MODULE CONTRACTS

## app/lib/engine/  (Agent: ENGINE)
All pure. `normalizeText` underpins everything.

### normalize.ts
```ts
export function normalizeText(input: string): string;       // lowercase, strip diacritics, remove urls/emails, collapse non-alphanumeric to spaces, trim
export function splitSentences(text: string): string[];     // naive sentence/line split of the ORIGINAL text (for example quotes)
```

### stopwords.ts
```ts
export const STOP_WORDS: Set<string>;                        // ~100 common English stop words, lowercase
```

### tokenize.ts
```ts
export function tokenize(text: string, opts?: { removeStopWords?: boolean; minLength?: number }): string[];
export function ngrams(tokens: string[], n: number): string[]; // space-joined n-grams
```

### keyword-engine.ts
Matches messages against KEYWORD_GROUPS (phrase match on normalized text; multi-word terms matched as substrings with word boundaries; single tokens matched against tokens).
```ts
import type { KeywordHit, KeywordGroupResult, NormalizedMessage } from "~/lib/types";
export function extractHits(message: NormalizedMessage): KeywordHit[];          // all (group,keyword) hits in one message (dedupe per keyword per message)
export function buildKeywordGroupResults(messages: NormalizedMessage[], now: Date, windowDays?: number): KeywordGroupResult[];
// ^ aggregates counts, uniqueMessages, top keywords, exampleQuote (a sentence from a hitting message),
//   frictionWeight (from group), trend7/trend30 (via trend.ts). Returns groups with count>0,
//   sorted DESC by impact = count * frictionWeight.
```

### trend.ts
```ts
import type { NormalizedMessage, TrendPoint } from "~/lib/types";
export function pctChange(previous: number, recent: number): number;   // (recent-prev)/prev; prev===0 -> (recent>0?1:0)
export function computeTrend(timestamps: Date[], now: Date, windowDays: number): number; // recent window vs preceding window
export function dailyVolume(messages: NormalizedMessage[], now: Date, days: number): TrendPoint[]; // length=days, oldest->newest, yyyy-mm-dd
```

### product-confusion.ts
```ts
import type { NormalizedMessage, ProductInput, ProductConfusionResult } from "~/lib/types";
export function detectProductConfusion(messages: NormalizedMessage[], products: ProductInput[], limit?: number): ProductConfusionResult[];
// A message mentions a product if a significant title token (len>=4, non-stopword) or the handle appears in normalized content.
// confusionScore 0..100 from mentionCount weighted by friction of groups co-occurring in mentioning messages. Sorted DESC, default limit 10.
```

### faq-opportunity.ts
```ts
import type { KeywordGroupResult, ProductInput, PageInput, FaqOpportunityResult } from "~/lib/types";
export function detectFaqOpportunities(groups: KeywordGroupResult[], products: ProductInput[], pages: PageInput[]): FaqOpportunityResult[];
// For each group above a frequency threshold, check coverage: do any product descriptions/pages contain the group's terms?
// If NOT covered -> opportunity. priority 0..100 ~ frequency*(1-coverage). question = group.question. Sorted DESC by priority.
```

### competitor.ts
```ts
import type { NormalizedMessage, CompetitorMentionResult } from "~/lib/types";
export function detectCompetitors(messages: NormalizedMessage[], extraTerms?: string[]): CompetitorMentionResult[];
// Word-boundary match of DEFAULT_COMPETITOR_TERMS + extraTerms (lowercased) on normalized text. Sorted DESC by count.
```

### revenue-leakage.ts
```ts
import type { KeywordGroupResult, RevenueLeakageAlert } from "~/lib/types";
export function detectRevenueLeakage(groups: KeywordGroupResult[]): RevenueLeakageAlert[];
// Only LEAKAGE_GROUP_IDS groups. Alert when trend7 >= 0.5 AND count >= 3.
// severity: high if trend7>=2 || (trend7>=1 && count>=10); medium if trend7>=1; else low. Sorted by severity then trend7.
```

### insight-score.ts
```ts
import type { KeywordGroupResult, RevenueLeakageAlert, FaqOpportunityResult } from "~/lib/types";
export function computeInsightScore(args: { messageCount: number; keywordGroups: KeywordGroupResult[]; leakage: RevenueLeakageAlert[]; faq: FaqOpportunityResult[]; }): number;
// 0..100, higher=healthier. Start 100; subtract friction density penalty (sum count*frictionWeight / messageCount, scaled),
// minus leakage penalty (high=12, med=7, low=3), minus uncovered-FAQ penalty (priority-weighted). Clamp [0,100]. messageCount===0 -> 0.
```

### run-analysis.ts
```ts
import type { AnalysisInput, InsightResult } from "~/lib/types";
export function runAnalysis(input: AnalysisInput): InsightResult;
// Orchestrates everything. now = input.now ?? new Date(); windowDays = input.windowDays ?? 30.
// topQuestions: top groups by count -> { text: group.question, count, groupId }. weeklyTrend = dailyVolume(messages, now, 7).
// generatedAt = now.toISOString(). Returns a fully-populated InsightResult.
```

### index.ts
Re-export `runAnalysis` and the other functions + `KEYWORD_GROUPS`.

---

## app/lib/ai/  (Agent: AI)
Default OFF. App must work fully without any AI key.

### types.ts
```ts
import type { InsightResult } from "~/lib/types";
export type AIProviderId = "off" | "mock" | "groq" | "gemini";
export interface WeeklySummaryInput { shopDomain: string; insight: InsightResult; weekStart: string; weekEnd: string; }
export interface AIProvider { id: AIProviderId; label: string; isConfigured(): boolean; generateWeeklySummary(input: WeeklySummaryInput): Promise<string>; }
```

### summary.ts
```ts
import type { WeeklySummaryInput } from "./types";
export function buildMockSummary(input: WeeklySummaryInput): string;            // deterministic, rule-based markdown summary from insight data (NO network)
export function buildSummaryPrompt(input: WeeklySummaryInput): { system: string; user: string }; // compact prompt for LLM providers
```

### mock-provider.ts  ->  `export class MockProvider implements AIProvider` (id "mock", isConfigured()=>true, returns buildMockSummary)
### groq-provider.ts  ->  `export class GroqProvider implements AIProvider` (id "groq", isConfigured()=>!!process.env.GROQ_API_KEY, calls Groq chat completions via fetch using GROQ_API_KEY and GROQ_MODEL ?? "llama-3.1-8b-instant"; on error throw)
### gemini-provider.ts -> `export class GeminiProvider implements AIProvider` (id "gemini", isConfigured()=>!!process.env.GEMINI_API_KEY, calls Gemini generateContent via fetch using GEMINI_API_KEY and GEMINI_MODEL ?? "gemini-1.5-flash")

### index.ts
```ts
import type { AIProvider, AIProviderId } from "./types";
export function getAIProvider(providerId?: AIProviderId): AIProvider;  // providerId ?? (process.env.AI_PROVIDER as AIProviderId) ?? "off"; "off" -> an OffProvider (isConfigured()=>false, generateWeeklySummary throws)
export function isAIEnabled(): boolean;                                // env AI_PROVIDER is groq/gemini/mock AND that provider isConfigured()
// re-export types, MockProvider, buildMockSummary, buildSummaryPrompt
```
Route usage: if plan allows AI summary AND `getAIProvider().isConfigured()` → call it (count ai_summaries usage); else use `buildMockSummary` (always works, free).

---

## app/lib/billing/usage.ts + gating.ts  (Agent: BILLING)
plans.ts is OWNED by spine — DO NOT recreate it.

### usage.ts (DB-touching, but take a `db` param)
```ts
import type { PrismaClient } from "@prisma/client";
export type UsageMetric = "messages" | "analyses" | "ai_summaries";
export function monthPeriod(date: Date): string;     // "2026-06"
export function isoWeekPeriod(date: Date): string;    // "2026-W23" (ISO-8601 week)
export async function incrementUsage(db: PrismaClient, shopId: string, metric: UsageMetric, period: string, by?: number): Promise<number>; // upsert, returns new count
export async function getUsage(db: PrismaClient, shopId: string, metric: UsageMetric, period: string): Promise<number>;
export async function getUsageSnapshot(db: PrismaClient, shopId: string, plan: import("./plans").PlanId, now: Date): Promise<import("./gating").UsageSnapshot>;
```

### gating.ts (PURE — heavily tested)
```ts
import { PLANS, type PlanId } from "./plans";
export interface UsageSnapshot { plan: PlanId; messagesThisMonth: number; analysesThisWeek: number; aiSummariesThisMonth: number; }
export interface GateResult { allowed: boolean; reason?: string; limit?: number; used?: number; remaining?: number; }
export function canImportMessages(snapshot: UsageSnapshot, addCount: number): GateResult; // messagesThisMonth+addCount <= plan.messagesPerMonth
export function canRunAnalysis(snapshot: UsageSnapshot): GateResult;                       // analysesThisWeek < plan.analysesPerWeek
export function canGenerateAISummary(snapshot: UsageSnapshot): GateResult;                 // plan.features.aiWeeklySummary === true
export function canExportReport(plan: PlanId): GateResult;                                 // plan.features.exportReport === true
export function resolvePlan(opts: { activePlanId?: PlanId | null; devOverride?: string | null; isProduction: boolean }): PlanId;
// devOverride only honored when !isProduction and it's a valid PlanId; else activePlanId ?? "free".
```

### index.ts: re-export plans + usage + gating.

---

## app/lib/import/ + shopify-data + sample  (Agent: DATA)
### import/csv.ts
```ts
import type { NormalizedMessage } from "~/lib/types";
export interface ParsedMessage { content: string; occurredAt: Date; source: string; customerRef?: string | null; externalId?: string | null; }
export function parseCsv(raw: string): string[][];                   // RFC-ish CSV (handles quoted fields, commas, CRLF)
export function parseImport(raw: string, opts?: { source?: string; now?: Date }): ParsedMessage[];
// If input looks like CSV with a header (detects columns: content|message|note|body|text, date|created_at|occurred_at, email|customer),
// map accordingly. Otherwise treat each non-empty line/paragraph as one message. occurredAt defaults to now. source defaults to "csv"/"manual".
export function toNormalizedMessages(parsed: ParsedMessage[], idPrefix?: string): NormalizedMessage[]; // assign synthetic ids
```
### import/index.ts: re-export.

### shopify-data.server.ts
```ts
import type { NormalizedMessage, ProductInput, PageInput } from "~/lib/types";
export interface AdminLike { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>; }
export async function fetchOrders(admin: AdminLike, opts?: { first?: number }): Promise<NormalizedMessage[]>;   // order.note + order.email -> messages (source order_note / customer_email)
export async function fetchProducts(admin: AdminLike, opts?: { first?: number }): Promise<ProductInput[]>;       // products: id,title,handle,description/bodyHtml
export async function fetchPages(admin: AdminLike, opts?: { first?: number }): Promise<PageInput[]>;              // read_content pages (id,title,body) — wrap in try/catch; return [] if scope missing
export async function collectShopData(admin: AdminLike, opts?: { orders?: number; products?: number; pages?: number }): Promise<{ messages: NormalizedMessage[]; products: ProductInput[]; pages: PageInput[] }>;
```
GraphQL only (Admin API 2026-01). Use `const res = await admin.graphql(query, { variables }); const body = await res.json();`. Use product `description` field and order `note`/`email`. Be defensive (optional chaining, default []).

### sample-data.ts
```ts
import type { AnalysisInput, NormalizedMessage, PageInput, ProductInput } from "~/lib/types";
export const SAMPLE_PRODUCTS: ProductInput[];
export const SAMPLE_PAGES: PageInput[];
export interface SampleSeed { content: string; daysAgo: number; source: string; customerRef?: string; }
export const SAMPLE_SEEDS: SampleSeed[];                          // 45-60 realistic customer messages spanning MANY keyword groups, several product mentions, a few competitor mentions, and a RISING returns/shipping pattern in the last 7 days
export function getSampleMessages(now: Date): NormalizedMessage[];// materialize SAMPLE_SEEDS with occurredAt = now - daysAgo
export function buildSampleAnalysisInput(now?: Date): AnalysisInput;
```
The sample data is what powers the onboarding "Import sample data" button and must make the dashboard look populated and interesting.

---

## app/routes/  (Agents: ROUTES_DASH, ROUTES_OPS, SYSTEM)
Shop bootstrap pattern in every /app route loader:
```ts
const { session } = await authenticate.admin(request);
const shop = await ensureShop(prisma, session.shop);
```
Resolve plan for gating/UI:
```ts
const isProduction = process.env.NODE_ENV === "production";
const devOverride = isProduction ? null : (process.env.DEV_PLAN_OVERRIDE ?? null);
const plan = resolvePlan({ activePlanId: shop.plan as PlanId, devOverride, isProduction });
```
Empty-state rule: if there is no completed run AND no imported messages → show onboarding/empty state. Once real data exists, NEVER show sample/fake numbers.

### ROUTES_DASH owns:
- `app/routes/app.tsx` — embedded layout. `links` exports Polaris stylesheet (`import polarisStyles from "@shopify/polaris/build/esm/styles.css?url"`). loader returns `{ apiKey: process.env.SHOPIFY_API_KEY || "" }`. Renders `<AppProvider isEmbeddedApp apiKey={apiKey}>` (from `@shopify/shopify-app-remix/react`) with `<NavMenu>` (from `@shopify/app-bridge-react`) linking: `/app` (Home, rel="home"), `/app/insights`, `/app/products`, `/app/import`, `/app/reports`, `/app/settings`, `/app/billing`. Then `<Outlet/>`. Export `ErrorBoundary` = `boundary.error(useRouteError())` and `headers` = `boundary.headers`.
- `app/routes/app._index.tsx` — DASHBOARD. loader: ensureShop, latest run (`getLatestRun`+`parseRun`), message count, usage snapshot, plan. If empty → 3-step onboarding (1 Import sample data, 2 Run first analysis, 3 Review insights) with a "Load sample data" Form (POST to `/app/import` intent=sample) and "Run analysis" button. If has data → show: Insight Score (big, ProgressBar/Badge), Top customer questions, Top friction keywords, Products with most confusion (top 5), FAQ opportunities (top 5), Weekly trend (simple inline bar list — NO heavy chart lib), Revenue leakage alerts (Banner per high/med). Keep it fast/light.
- `app/routes/app.insights.tsx` — full keyword group table (DataTable): group, count, trend7, trend30, example quote; competitor mentions section; top questions. Reads latest run summaryJson.
- `app/routes/app.products.tsx` — products-with-confusion DataTable (title, mentions, confusion score, top groups) from latest run.

### ROUTES_OPS owns:
- `app/routes/app.import.tsx` — loader: usage snapshot + plan + recent message count. UI: (a) "Load sample data" button, (b) paste textarea (CSV or conversation text) + source Select + Import button, (c) shows monthly message usage vs limit. action handles `intent`: `sample` (insert SAMPLE_SEEDS as ImportedMessage rows, gated by canImportMessages), `import` (parseImport the textarea, gate, insert), `analyze` (gate canRunAnalysis → load messages+sample/products → runAnalysis → saveInsightRun → increment analyses usage → redirect to `/app`). Increment `messages` usage on import. After first run, mark onboarded.
- `app/routes/app.reports.tsx` — loader: recent WeeklyReports + latest run + plan. UI: list reports; "Generate weekly summary" button (only enabled if plan.aiWeeklySummary; uses AI if configured else rule-based buildMockSummary). action: gate canGenerateAISummary → build summary (AI or mock) → create WeeklyReport (aiProvider set accordingly) → if AI used increment ai_summaries usage. Export button (canExportReport) returns the report as a downloadable .md/.json Response.
- `app/routes/app.settings.tsx` — loader: AppSetting values (aiProviderId display only, competitorTerms, autoCleanup). action: upsert AppSetting rows. Show which AI provider is active (read-only, from env) and whether configured. Competitor terms textarea saved to AppSetting key "competitorTerms".
- `app/routes/app.billing.tsx` — loader: `billing.check({ plans: PAID_PLAN_NAMES, isTest: !isProduction })`, current plan, usage snapshot, and (dev only) the DEV_PLAN_OVERRIDE notice. UI: plan cards (Free/Starter/Growth/Pro) from PLANS with features + price; current plan badge; "Choose plan" buttons. action `intent=subscribe` → `billing.request({ plan: PLANS[id].name, isTest: !isProduction, returnUrl: <app url>/app/billing })`. `intent=cancel` optional. In development show a Select to set DEV_PLAN_OVERRIDE note (display only; actual override via env). NEVER render dev override UI when `process.env.NODE_ENV === "production"`.

### SYSTEM owns:
- `app/root.tsx` — minimal HTML document (html/head with Meta+Links, body with Outlet+ScrollRestoration+Scripts). Preconnect to cdn.shopify.com.
- `app/entry.server.tsx` — standard Remix streaming entry using `isbot` + `addDocumentResponseHeaders` from shopify.server (use the official Shopify template entry.server for embedded apps; call `addDocumentResponseHeaders(request, responseHeaders)`).
- `app/routes/_index/route.tsx` — public landing/redirect. loader: if `new URL(request.url).searchParams.get("shop")` → `redirect("/app?"+searchParams)`. Render a tiny non-embedded marketing page + a login form (`<Form method="post" action="/auth/login">` with shop domain TextField) using `_index/route` + plain HTML (no Polaris AppProvider). Provide `app/routes/_index/styles.module.css` minimal.
- `app/routes/auth.$.tsx` — `loader` calls `await authenticate.admin(request); return null;`
- `app/routes/auth.login/route.tsx` — login form using `login(request)` from shopify.server (loader returns `{ errors, polarisTranslations }`? Keep close to template: loader returns login errors, action calls `login`). Use Polaris AppProvider (i18n) for the standalone login page. Include `app/routes/auth.login/error.server.ts` (`loginErrorMessage`).
- `app/routes/webhooks.app.uninstalled.tsx` — `action`: `const { shop, topic } = await authenticate.webhook(request); await cleanupShop(prisma, shop); return new Response();` (handle session possibly undefined).
- `app/routes/webhooks.app.scopes_update.tsx` — `action`: authenticate.webhook; update session scope if present; return 200. (App-specific webhook.)
- `app/routes/health[.]tsx`? NO — use these two resource routes (loaders only, return json, NO default export, NOT authenticated):
  - `app/routes/health._index.tsx` → GET `/health`: returns `getHealth()` from `app/lib/health.server.ts`.
  - `app/routes/health.config.tsx` → GET `/health/config`: returns `getConfigHealth()` from `app/lib/health.server.ts`.

### SYSTEM also owns app/lib/health.server.ts (PURE, tested):
```ts
export interface HealthStatus { status: "ok"; service: string; time: string; }            // time = new Date().toISOString()
export interface ConfigHealth { status: "ok" | "degraded"; checks: Record<string, boolean>; missing: string[]; }
export function getHealth(now?: Date): HealthStatus;
export function getConfigHealth(env?: NodeJS.ProcessEnv): ConfigHealth;
// checks: SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_APP_URL, DATABASE_URL, SCOPES present (booleans). status "degraded" if any required missing. AI keys are optional (not required). NEVER return secret values.
```

---

## tests/  (Agent: TESTS) — Vitest, import via `~/...`
Create these files. Use `now = new Date("2026-06-01T00:00:00Z")` for determinism where needed.
- `tests/keyword-engine.test.ts` — extractHits + buildKeywordGroupResults find expected groups; sorting by impact.
- `tests/trend.test.ts` — pctChange edge cases (prev 0), computeTrend recent>prev, dailyVolume length & bucketing.
- `tests/faq-opportunity.test.ts` — uncovered topic -> opportunity; covered topic (term present in a page/product) -> hasContent true / not an opportunity.
- `tests/product-confusion.test.ts` — messages mentioning a product title produce a ProductConfusionResult with mentionCount and score>0; unmentioned product absent.
- `tests/usage-limit.test.ts` — incrementUsage with a FAKE PrismaClient (object with vi.fn upsert) returns incremented count; monthPeriod/isoWeekPeriod formatting.
- `tests/billing-gating.test.ts` — canImportMessages over/under limit; canRunAnalysis weekly limit; canGenerateAISummary by plan; canExportReport by plan; resolvePlan honors devOverride only when !isProduction.
- `tests/webhook-uninstall.test.ts` — cleanupShop calls session.deleteMany({where:{shop}}) and shop.deleteMany({where:{shopDomain}}) on a FAKE PrismaClient; returns counts.
- `tests/health.test.ts` — getHealth().status==="ok"; getConfigHealth with all keys -> "ok"/missing empty; with missing required key -> "degraded" and lists it; AI keys absent does NOT degrade.
- `tests/run-analysis.test.ts` — runAnalysis(buildSampleAnalysisInput(now)) returns messageCount>0, insightScore in [0,100], non-empty keywordGroups, weeklyTrend length 7.
Fake PrismaClient pattern: `const db = { session: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) }, shop: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) } } as unknown as import("@prisma/client").PrismaClient;`

---

## Deploy + docs + scripts  (Agent: DEPLOY)
- `Dockerfile` — node:22-slim base, install openssl, `npm ci`, `npx prisma generate`, `npm run build`, CMD `node ./scripts/start-production.mjs`. Use $PORT (Cloud Run sets it; default 8080).
- `.env.example`, `.env.production.example` — all env vars (SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SHOPIFY_APP_URL, SCOPES, DATABASE_URL, NODE_ENV, PORT, AI_PROVIDER, GROQ_API_KEY, GROQ_MODEL, GEMINI_API_KEY, GEMINI_MODEL, DEV_PLAN_OVERRIDE, SHOP_CUSTOM_DOMAIN).
- `README.md` — overview, local dev, Partner app creation, env, scripts, verify commands.
- `DEPLOY_GOOGLE_CLOUD_RUN.md` — Cloud SQL Postgres + Cloud Run steps, build/deploy commands, env wiring, migrate.
- `shopify.app.toml` (dev) + `shopify.app.production.toml` — embedded=true, scopes = "read_products,read_orders,read_customers,read_content", app-specific webhooks for app/uninstalled and app/scopes_update (api_version 2026-01), `[access_scopes]`, `[webhooks]`, `[auth] redirect_urls`. Use placeholder client_id.
- `scripts/start-production.mjs` — run `prisma migrate deploy` then start `@remix-run/serve` on $PORT (import `createRequestHandler`? simplest: spawn `remix-serve ./build/server/index.js`). Must bind 0.0.0.0 and use PORT (default 8080).
- `scripts/check-env.mjs` — validate required env vars, print a table, exit 1 if missing required (uses same required set as health config).
- `scripts/seed-sample-data.ts` — tsx script: connect prisma, upsert a Shop (env SEED_SHOP_DOMAIN or "dev-shop.myshopify.com"), insert SAMPLE_SEEDS as ImportedMessage, run analysis, saveInsightRun. Log summary.

SCOPES used by the app (V1, read-only): `read_products,read_orders,read_customers,read_content`.
```
