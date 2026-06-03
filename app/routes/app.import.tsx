import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  BlockStack,
  Banner,
  Button,
  Card,
  ProgressBar,
  Select,
  Text,
} from "@shopify/polaris";
import { useEffect, useState } from "react";

import prisma from "~/db.server";
import { ACTION_TIMEOUT_MS, formActionKey, makeActionKey } from "~/lib/action-loading";
import {
  canImportMessages,
  canRunAnalysis,
  getUsageSnapshot,
  getDevPlanOverride,
  incrementUsage,
  isoWeekPeriod,
  monthPeriod,
  resolvePlan,
  type PlanId,
} from "~/lib/billing";
import { parseImport, sanitizeImportSource } from "~/lib/import";
import { runAnalysis } from "~/lib/engine";
import { hasActionableRecoveryInsight } from "~/lib/insight-guards";
import { syncShopifyData } from "~/lib/shopify-data.server";
import type { ShopifySyncResult } from "~/lib/shopify-data.server";
import type { ImportedMessage } from "@prisma/client";
import {
  filterNewSampleMessages,
  getSampleMessages,
  isSampleDataEnabled,
} from "~/lib/sample-data";
import { ensureShop, getLatestRun, markOnboarded, parseRun, saveInsightRun } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";
import { AppPage, KpiCard, SectionHeader } from "~/components";
import { getDelegate, safeCount } from "~/lib/prisma-safe";
import { logUsage } from "~/lib/log-usage.server";
import { orderSyncStatusText, productSyncStatusText } from "~/lib/sync-status";
import { getShopifyProductSchemaDiagnostics } from "~/lib/schema-diagnostics.server";
import { ANALYSIS_EXCLUDED_MESSAGE_SOURCES, ANALYSIS_MESSAGE_LIMIT, parseStringArray } from "~/lib/utils";
import {
  checkExpiringOfflineTokenForAction,
  requireScopesOrRedirect,
  checkScopesForAction,
  REQUIRED_SYNC_SCOPES,
  REQUIRED_APP_SCOPES,
} from "~/lib/scope-guard.server";

const CUSTOMER_APPROVAL_COPY = "Protected customer data approval required for customer profiles.";

const EMPTY_SYNC: ShopifySyncResult = {
  products: { ok: false, count: 0, skipped: true },
  orders: { ok: false, count: 0, skipped: true },
  customers: { ok: false, count: 0, skipped: true, reason: "Protected customer data not approved" },
  messages: 0,
};

async function shopContext(request: Request) {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  const isProduction = process.env.NODE_ENV === "production";
  const plan = resolvePlan({
    activePlanId: shop.plan as PlanId,
    devOverride: getDevPlanOverride(),
    devOverrideEnabled: process.env.ENABLE_DEV_PLAN_OVERRIDE === "true",
    isProduction,
  });
  return { shop, plan, admin, session };
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { shop, plan, session } = await shopContext(request);

    // Enforce required scopes. Throws a redirect to /auth?shop=... if any are
    // missing, which re-triggers the OAuth flow for the full scope grant.
    requireScopesOrRedirect(session, REQUIRED_APP_SCOPES);
    const tokenCheck = checkExpiringOfflineTokenForAction(session);

    const url = new URL(request.url);
    const debugMode = process.env.NODE_ENV !== "production" ? url.searchParams.get("debug") : null;
    const now = new Date();
    const usage = await getUsageSnapshot(prisma, shop.id, plan, now);
    const customerQuestionWhere = {
      shopId: shop.id,
      source: { notIn: [...ANALYSIS_EXCLUDED_MESSAGE_SOURCES] },
    };
    const [recentMessageCount, productCount, orderCount, latestRun] = await Promise.all([
      safeCount(prisma, "importedMessage", { where: customerQuestionWhere }),
      safeCount(prisma, "shopifyProduct", { where: { shopId: shop.id } }),
      safeCount(prisma, "shopifyOrder", { where: { shopId: shop.id } }),
      getLatestRun(prisma, shop.id),
    ]);
    const analyzedProductCount = latestRun?.productCount ?? 0;
    const analyzedMessageCount = latestRun?.messageCount ?? 0;
    const isDataStale = latestRun != null && (
      recentMessageCount !== analyzedMessageCount ||
      productCount !== analyzedProductCount
    );
    const isDevMode = process.env.NODE_ENV !== "production";
    const analysisGate = canRunAnalysis(usage);

    const analysisDebug = debugMode === "analysis" ? {
      analyzedProductCount,
      currentProductCount: productCount,
      analyzedMessageCount,
      currentMessageCount: recentMessageCount,
      analysesThisWeek: usage.analysesThisWeek,
      weeklyLimit: usage.analysesThisWeek,
      isDataStale,
      weeklyLimitBlocking: !analysisGate.allowed,
      reason: isDataStale
        ? "Products or messages changed since last analysis — bypass active"
        : !analysisGate.allowed
          ? "Weekly limit reached and data is current"
          : "ok — analysis can run normally",
    } : null;

    return json({
      usage,
      plan,
      recentMessageCount,
      productCount,
      orderCount,
      isDataStale,
      analysisGateAllowed: analysisGate.allowed,
      isDevMode,
      lastSync: null,
      reauthorizeRequired: !tokenCheck.ok,
      reauthorizeUrl: tokenCheck.ok ? null : tokenCheck.reauthorizeUrl,
      reauthorizeReason: tokenCheck.ok ? null : tokenCheck.reason,
      loadError: null,
      sampleDataEnabled: isSampleDataEnabled(),
      analysisDebug,
      syncDebug: debugMode === "sync"
        ? {
            productsDelegateAvailable: Boolean(getDelegate(prisma, "shopifyProduct")?.upsert),
            productsCountInDb: productCount,
            expectedScopes: ["read_products", "read_orders", "read_content"],
            grantedScopes: session.scope ?? "",
            sampleDataEnabled: isSampleDataEnabled(),
          }
        : null,
      schemaDebug: debugMode === "schema"
        ? await getShopifyProductSchemaDiagnostics(prisma)
        : null,
    });
  } catch (error) {
    // Re-throw Remix redirects (e.g. from requireScopesOrRedirect) so they
    // are not swallowed by this error-fallback handler.
    if (error instanceof Response) throw error;
    console.error("Import loader failed", error);
    return json({
      usage: { plan: "free", messagesThisMonth: 0, analysesThisWeek: 0, aiSummariesThisMonth: 0 },
      plan: "free",
      recentMessageCount: 0,
      productCount: 0,
      orderCount: 0,
      isDataStale: false,
      analysisGateAllowed: true,
      isDevMode: process.env.NODE_ENV !== "production",
      lastSync: null,
      reauthorizeRequired: false,
      reauthorizeUrl: null,
      reauthorizeReason: null,
      loadError: "Some data could not be loaded. Your store data is safe. Try refreshing or run analysis again.",
      sampleDataEnabled: isSampleDataEnabled(),
      analysisDebug: null,
      syncDebug: null,
      schemaDebug: null,
    });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const { shop, plan, admin, session } = await shopContext(request);
  const now = new Date();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const usage = await getUsageSnapshot(prisma, shop.id, plan, now);

  if (intent === "sample") {
    if (!isSampleDataEnabled()) {
      return json({ error: "Sample data is disabled for real-store testing." }, { status: 403 });
    }
    const messages = getSampleMessages(now);
    const existing = await prisma.importedMessage.findMany({
      where: {
        shopId: shop.id,
        externalId: { in: messages.map((message) => message.externalId).filter(Boolean) as string[] },
      },
      select: { externalId: true },
    });
    const missing = filterNewSampleMessages(
      messages,
      existing.map((message) => message.externalId),
    );
    const gate = canImportMessages(usage, missing.length);
    if (!gate.allowed) return json({ error: gate.reason }, { status: 403 });
    if (missing.length > 0) {
      await prisma.importedMessage.createMany({
        data: missing.map((message) => ({
          shopId: shop.id,
          source: message.source,
          content: message.content,
          occurredAt: message.occurredAt,
          customerRef: message.customerRef,
          externalId: message.externalId,
        })),
      });
      await incrementUsage(prisma, shop.id, "messages", monthPeriod(now), missing.length);
    }
    return redirect("/app/import");
  }

  if (intent === "import") {
    const raw = String(form.get("raw") ?? "");
    const source = sanitizeImportSource(String(form.get("source") ?? ""));
    const parsed = parseImport(raw, { source, now });
    const gate = canImportMessages(usage, parsed.length);
    if (!gate.allowed) return json({ error: gate.reason }, { status: 403 });
    await prisma.importedMessage.createMany({
      data: parsed.map((message) => ({
        shopId: shop.id,
        source: message.source,
        content: message.content,
        occurredAt: message.occurredAt,
        customerRef: message.customerRef,
        externalId: message.externalId,
      })),
    });
    await incrementUsage(prisma, shop.id, "messages", monthPeriod(now), parsed.length);
    return redirect("/app/import");
  }

  if (intent === "sync") {
    const tokenCheck = checkExpiringOfflineTokenForAction(session);
    if (!tokenCheck.ok) {
      return json({
        error: `${tokenCheck.reason} Visit ${tokenCheck.reauthorizeUrl} to clear the stale session and reauthorize.`,
      });
    }
    const scopeCheck = checkScopesForAction(session, REQUIRED_SYNC_SCOPES);
    if (!scopeCheck.ok) {
      const missing = scopeCheck.missing.join(", ");
      const reauthorizeUrl = `/auth/reauthorize?shop=${encodeURIComponent(session.shop)}`;
      return json({
        error: `Sync requires reauthorization — missing scopes: ${missing}. Visit ${reauthorizeUrl} to clear the stale session and reauthorize, or uninstall and reinstall the app from Shopify Admin.`,
      });
    }
    const sync = await syncShopifyData(prisma, shop.id, admin, {
      shopDomain: shop.shopDomain,
      grantedScopes: session.scope,
      accessToken: session.accessToken,
    });
    return json({ ok: true, sync });
  }

  if (intent === "analyze" || intent === "force-analyze") {
    const isDevMode = process.env.NODE_ENV !== "production";
    // Stale detection: products or messages changed since the last analysis snapshot.
    // When stale, bypass the weekly limit — new data requires fresh analysis.
    const [currentMessageCount, currentProductCountForStale, latestRunForStale] = await Promise.all([
      safeCount(prisma, "importedMessage", {
        where: { shopId: shop.id, source: { notIn: [...ANALYSIS_EXCLUDED_MESSAGE_SOURCES] } },
      }),
      safeCount(prisma, "shopifyProduct", { where: { shopId: shop.id } }),
      getLatestRun(prisma, shop.id),
    ]);
    const isDataStale = latestRunForStale != null && (
      currentMessageCount !== (latestRunForStale.messageCount ?? 0) ||
      currentProductCountForStale !== (latestRunForStale.productCount ?? 0)
    );
    if (currentMessageCount === 0) {
      return json({
        error: "No customer questions found yet. Syncing products is useful, but analysis needs imported chats, emails, support messages, or order notes.",
      });
    }
    const gate = canRunAnalysis(usage, { bypass: isDevMode || isDataStale });
    if (!gate.allowed) return json({ error: gate.reason }, { status: 403 });
    const importedMessage = getDelegate(prisma, "importedMessage");
    const stored = importedMessage?.findMany
      ? await importedMessage.findMany({
          where: { shopId: shop.id, source: { notIn: [...ANALYSIS_EXCLUDED_MESSAGE_SOURCES] } },
          take: ANALYSIS_MESSAGE_LIMIT,
          orderBy: { occurredAt: "desc" },
        })
      : [];
    const [storedProducts, settings] = await Promise.all([
      prisma.shopifyProduct.findMany({ where: { shopId: shop.id }, orderBy: { updatedAt: "desc" }, take: 1000 }),
      prisma.appSetting.findMany({ where: { shopId: shop.id } }),
    ]);
    const settingValues = Object.fromEntries(settings.map((setting) => [setting.key, setting.value]));
    const competitorTerms = String(settingValues.competitorTerms ?? "")
      .split(/[\n,]/)
      .map((term) => term.trim())
      .filter(Boolean);
    const products = storedProducts.length
      ? storedProducts.map((product) => ({
          id: product.externalId,
          title: product.title,
          handle: product.handle ?? undefined,
          vendor: product.vendor,
          updatedAt: product.shopifyUpdatedAt,
          description: product.description ?? "",
          tags: parseStringArray(product.tags),
          productType: product.productType,
          collections: parseStringArray(product.collections),
        }))
      : [];
    const input = {
      messages: (stored as ImportedMessage[]).map((message) => ({
        id: message.id,
        content: message.content,
        occurredAt: message.occurredAt,
        source: message.source,
        customerRef: message.customerRef,
        externalId: message.externalId,
      })),
      products,
      pages: [],
      competitorTerms,
      now,
      windowDays: 30,
    };
    const result = runAnalysis(input);
    if (!hasActionableRecoveryInsight(result)) {
      return json({
        error: "Analysis ran, but no buying objections were detected. Add questions about shipping, returns, payment, sizing, stock, discounts, warranty, usage, ingredients, or competitor comparisons.",
      });
    }
    // Use the real DB total (currentProductCountForStale) so the staleness check
    // never disagrees with itself regardless of how many products were sampled.
    await saveInsightRun(prisma, shop.id, result, 30, currentProductCountForStale);
    await incrementUsage(prisma, shop.id, "analyses", isoWeekPeriod(now), 1);
    await markOnboarded(prisma, shop.id);
    await logUsage(prisma, shop.id, "insight_run", { messageCount: currentMessageCount });
    return redirect("/app");
  }

  return redirect("/app/import");
}

export default function ImportPage() {
  const {
    usage,
    recentMessageCount,
    productCount,
    orderCount,
    isDataStale,
    analysisGateAllowed,
    isDevMode,
    lastSync,
    reauthorizeRequired,
    reauthorizeUrl,
    reauthorizeReason,
    loadError,
    sampleDataEnabled,
    analysisDebug,
    syncDebug,
    schemaDebug,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [source, setSource] = useState("manual");
  const [messages, setMessages] = useState("");
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const [pendingStartedAt, setPendingStartedAt] = useState<number | null>(null);
  const [timeoutWarning, setTimeoutWarning] = useState(false);
  const activeFormKey = formActionKey(navigation.formData);
  const loadingFor = (actionKey: string) =>
    navigation.state !== "idle" && (activeFormKey === actionKey || pendingActionKey === actionKey);
  const markPending = (actionKey: string) => {
    setPendingActionKey(actionKey);
    setPendingStartedAt(Date.now());
    setTimeoutWarning(false);
  };
  useEffect(() => {
    if (navigation.state === "idle") {
      setPendingActionKey(null);
      setPendingStartedAt(null);
    }
  }, [navigation.state]);
  useEffect(() => {
    if (!pendingActionKey || pendingStartedAt === null) return;
    const timeout = window.setTimeout(() => {
      setPendingActionKey(null);
      setPendingStartedAt(null);
      setTimeoutWarning(true);
    }, ACTION_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [pendingActionKey, pendingStartedAt]);
  return (
    <AppPage
      title="Revenue Recovery Onboarding"
      subtitle="Move from customer conversations to revenue recovery content in four steps."
      primaryAction={recentMessageCount > 0 ? (
        <Form method="post">
          <input type="hidden" name="intent" value="analyze" />
          <input type="hidden" name="actionKey" value={makeActionKey("run:analysis")} />
          <Button variant="primary" submit loading={loadingFor(makeActionKey("run:analysis"))} disabled={loadingFor(makeActionKey("run:analysis"))} onClick={() => markPending(makeActionKey("run:analysis"))}>Run analysis</Button>
        </Form>
      ) : <Button url="/app/import#customer-messages" variant="primary">Add customer questions</Button>}
    >
      <BlockStack gap="500">
        {loadError ? (
          <Card>
            <Text as="p" variant="bodyMd" tone="critical">
              {loadError}
            </Text>
          </Card>
        ) : null}
        {reauthorizeRequired ? (
          <Banner tone="warning" title="Reconnect Shopify sync">
            <p>{reauthorizeReason}</p>
            <Button url={reauthorizeUrl ?? "/app/import"} variant="primary">Reauthorize Shopify</Button>
          </Banner>
        ) : null}
        {timeoutWarning ? (
          <Banner tone="warning" title="Action took longer than expected">
            <p>Action took longer than expected. You can safely retry.</p>
          </Banner>
        ) : null}
        {isDataStale && !analysisGateAllowed ? (
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="caution">
                <strong>New products or messages detected.</strong> Products were synced after the last analysis. A fresh analysis is required to generate product-level insights.
              </Text>
              <Form method="post">
                <input type="hidden" name="intent" value="analyze" />
                <input type="hidden" name="actionKey" value={makeActionKey("run:analysis")} />
                <Button variant="primary" submit loading={loadingFor(makeActionKey("run:analysis"))} disabled={loadingFor(makeActionKey("run:analysis"))} onClick={() => markPending(makeActionKey("run:analysis"))}>Run fresh analysis</Button>
              </Form>
            </BlockStack>
          </Card>
        ) : null}
        {isDevMode && !analysisGateAllowed && !isDataStale ? (
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" tone="caution">
                Weekly analysis limit reached. In development mode you can force a re-run.
              </Text>
              <Form method="post">
                <input type="hidden" name="intent" value="force-analyze" />
                <input type="hidden" name="actionKey" value={makeActionKey("run:analysis:force")} />
                <Button submit loading={loadingFor(makeActionKey("run:analysis:force"))} disabled={loadingFor(makeActionKey("run:analysis:force"))} onClick={() => markPending(makeActionKey("run:analysis:force"))}>Force reanalyze (dev only)</Button>
              </Form>
            </BlockStack>
          </Card>
        ) : null}
        {analysisDebug ? (
          <Card>
            <BlockStack gap="150">
              <SectionHeader title="Analysis debug" description="Development-only. Accessible via ?debug=analysis" />
              <Text as="p" variant="bodySm"><strong>Analyzed products (last run contentGaps):</strong> {analysisDebug.analyzedProductCount}</Text>
              <Text as="p" variant="bodySm"><strong>Current products (DB):</strong> {analysisDebug.currentProductCount}</Text>
              <Text as="p" variant="bodySm"><strong>Analyzed messages (last run messageCount):</strong> {analysisDebug.analyzedMessageCount}</Text>
              <Text as="p" variant="bodySm"><strong>Current messages (DB):</strong> {analysisDebug.currentMessageCount}</Text>
              <Text as="p" variant="bodySm"><strong>Analyses this week:</strong> {analysisDebug.analysesThisWeek}</Text>
              <Text as="p" variant="bodySm"><strong>Analysis stale:</strong> {analysisDebug.isDataStale ? "yes" : "no"}</Text>
              <Text as="p" variant="bodySm"><strong>Weekly limit blocking:</strong> {analysisDebug.weeklyLimitBlocking ? "yes" : "no"}</Text>
              <Text as="p" variant="bodySm"><strong>Reason:</strong> {analysisDebug.reason}</Text>
            </BlockStack>
          </Card>
        ) : null}
        {actionData && "sync" in actionData ? (
          <Card>
            <BlockStack gap="200">
              <SectionHeader title="Sync status" description="Product and order analysis continues even when protected customer data is unavailable." />
              <Text as="p" variant="bodyMd">
                Products: {productSyncStatusText(actionData.sync.products)}
              </Text>
              <Text as="p" variant="bodyMd">
                Orders: {orderSyncStatusText(actionData.sync.orders)}
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                Customers skipped: {actionData.sync.customers.reason ?? CUSTOMER_APPROVAL_COPY}
              </Text>
              {actionData.sync.products.error ? (
                <Text as="p" variant="bodySm" tone="critical">
                  Products sync failed: {actionData.sync.products.error}
                </Text>
              ) : null}
              {actionData.sync.orders.error ? (
                <Text as="p" variant="bodySm" tone="critical">
                  Orders sync failed: {actionData.sync.orders.error}
                </Text>
              ) : null}
              {isDevMode && (actionData.sync.products.error || actionData.sync.orders.error) ? (
                <pre style={{ fontSize: 11, background: "#f5f5f5", padding: 8, borderRadius: 4, overflowX: "auto", whiteSpace: "pre-wrap" }}>
                  {JSON.stringify({ products: actionData.sync.products, orders: actionData.sync.orders }, null, 2)}
                </pre>
              ) : null}
            </BlockStack>
          </Card>
        ) : null}
        {syncDebug ? (
          <Card>
            <BlockStack gap="150">
              <SectionHeader title="Sync debug" description="Development-only diagnostics. No tokens or secrets are shown." />
              <Text as="p" variant="bodySm">Products delegate available: {syncDebug.productsDelegateAvailable ? "yes" : "no"}</Text>
              <Text as="p" variant="bodySm">Products count in DB: {syncDebug.productsCountInDb}</Text>
              <Text as="p" variant="bodySm">Expected scopes: {syncDebug.expectedScopes.join(", ")}</Text>
              <Text as="p" variant="bodySm">Granted scopes: {syncDebug.grantedScopes || "unknown"}</Text>
              <Text as="p" variant="bodySm">Sample data enabled: {syncDebug.sampleDataEnabled ? "yes" : "no"}</Text>
            </BlockStack>
          </Card>
        ) : null}
        {schemaDebug ? (
          <Card>
            <BlockStack gap="150">
              <SectionHeader title="Schema debug" description="Development-only schema diagnostics. No tokens or secrets are shown." />
              <Text as="p" variant="bodySm">Prisma delegate available: {schemaDebug.delegateAvailable ? "yes" : "no"}</Text>
              <Text as="p" variant="bodySm">ShopifyProduct columns found: {schemaDebug.dbColumns.join(", ") || "none"}</Text>
              <Text as="p" variant="bodySm">Migration version: {schemaDebug.migrationVersion ?? "missing"}</Text>
              <Text as="p" variant="bodySm">Compatibility mode: {schemaDebug.compatibilityMode ? "enabled" : "disabled"}</Text>
              <Text as="p" variant="bodySm">tags: {schemaDebug.hasTags ? "yes" : "no"} / client: {schemaDebug.clientHasTags ? "yes" : "no"}</Text>
              <Text as="p" variant="bodySm">productType: {schemaDebug.hasProductType ? "yes" : "no"} / client: {schemaDebug.clientHasProductType ? "yes" : "no"}</Text>
              <Text as="p" variant="bodySm">collections: {schemaDebug.hasCollections ? "yes" : "no"} / client: {schemaDebug.clientHasCollections ? "yes" : "no"}</Text>
              {schemaDebug.error ? (
                <Text as="p" variant="bodySm" tone="critical">{schemaDebug.error}</Text>
              ) : null}
            </BlockStack>
          </Card>
        ) : null}
        {actionData && "error" in actionData ? (
          <Card>
            <Text as="p" variant="bodyMd" tone="critical">
              {actionData.error}
            </Text>
          </Card>
        ) : null}
        <div className="cia-section-band">
          <BlockStack gap="300">
            <SectionHeader
              title="Recovery setup wizard"
              description="Complete each step to find lost sales and create the content that recovers them."
            />
            <ProgressBar progress={recentMessageCount > 0 ? 50 : 20} tone="primary" />
            <div className="cia-progress-steps">
            {[
              ["1", "Import conversations", recentMessageCount > 0],
              ["2", "Analyze customer questions", false],
              ["3", "Generate revenue opportunities", false],
              ["4", "Publish recovery content", false],
            ].map(([step, label, done]) => (
              <div className="cia-muted-panel" key={String(step)}>
                <BlockStack gap="150">
                <div className="cia-rank">{String(step)}</div>
                  <Text as="h3" variant="headingSm">
                    {String(label)}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {done ? "Completed" : "Next recovery step"}
                  </Text>
                <Button url={step === "1" ? "/app/import" : step === "2" ? "/app/import" : "/app/faq"}>
                  {done ? "Review" : "Start"}
                </Button>
                </BlockStack>
              </div>
            ))}
            </div>
          </BlockStack>
        </div>

        <div className="cia-three-grid">
          <KpiCard
            label="Messages this month"
            value={usage.messagesThisMonth.toLocaleString("en-US")}
            detail={`${recentMessageCount} stored conversations`}
            tone="info"
          />
          <KpiCard
            label="Next step"
            value={recentMessageCount > 0 ? "Run analysis" : "Ready to analyze customer questions"}
            detail="Find revenue opportunities after data is loaded"
            tone="success"
          />
          <KpiCard
            label="Data status"
            value={productCount > 0 || recentMessageCount > 0 ? "Ready" : "Sync product and order data"}
            detail={`${productCount} products · ${orderCount} orders · ${recentMessageCount} questions`}
            tone={recentMessageCount > 0 ? "success" : "warning"}
          />
        </div>

        <div className="cia-two-grid">
          <Card>
            <Form method="post">
              <BlockStack gap="300">
                <SectionHeader title="Step 1: Sync product and order data" description="Product content sync, product gap analysis, and order notes if available." />
                <input type="hidden" name="intent" value="sync" />
                <input type="hidden" name="actionKey" value={makeActionKey("sync:products")} />
                <Button submit loading={loadingFor(makeActionKey("sync:products"))} disabled={loadingFor(makeActionKey("sync:products"))} variant="primary" onClick={() => markPending(makeActionKey("sync:products"))}>Sync product and order data</Button>
                <Text as="p" variant="bodySm" tone="subdued">
                  Supported now: product content sync, product gap analysis, imported customer questions, and order notes if available.
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Not available yet: customer profile analysis. {CUSTOMER_APPROVAL_COPY}
                </Text>
                <Button url="/app">Continue with product analysis</Button>
              </BlockStack>
            </Form>
          </Card>
          {sampleDataEnabled ? (
            <Card>
              <Form method="post">
                <BlockStack gap="300">
                  <SectionHeader title="Preview with sample conversations" description="Explore the recovery workflow before importing live customer questions." />
                  <input type="hidden" name="intent" value="sample" />
                  <input type="hidden" name="actionKey" value={makeActionKey("load:sample-data")} />
                  <Button submit loading={loadingFor(makeActionKey("load:sample-data"))} disabled={loadingFor(makeActionKey("load:sample-data"))} onClick={() => markPending(makeActionKey("load:sample-data"))}>Load sample data</Button>
                </BlockStack>
              </Form>
            </Card>
          ) : null}
        </div>

        <Card>
          <Form method="post">
            <BlockStack gap="300">
              <SectionHeader title="Step 1: Import conversations" description="Paste support messages, chats, emails, or CSV rows." />
              <input type="hidden" name="intent" value="import" />
              <Select
                label="Source"
                name="source"
                options={["manual", "csv", "chat", "email"]}
                value={source}
                onChange={setSource}
              />
              <div>
                <label htmlFor="customer-messages" style={{ display: "block", marginBottom: 6, fontSize: 14, fontWeight: 500 }}>
                  Messages or CSV
                </label>
                <textarea
                  id="customer-messages"
                  name="raw"
                  value={messages}
                  onChange={(e) => setMessages(e.target.value)}
                  rows={12}
                  style={{
                    width: "100%",
                    minHeight: "300px",
                    padding: "12px",
                    border: "1px solid #d0d0d0",
                    borderRadius: "8px",
                    fontFamily: "inherit",
                    fontSize: "14px",
                    resize: "vertical",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <input type="hidden" name="actionKey" value={makeActionKey("import:messages")} />
              <Button submit loading={loadingFor(makeActionKey("import:messages"))} disabled={loadingFor(makeActionKey("import:messages"))} onClick={() => markPending(makeActionKey("import:messages"))}>Add customer questions</Button>
            </BlockStack>
          </Form>
        </Card>

        <Card>
          <Form method="post">
            <BlockStack gap="300">
              <SectionHeader title="Step 2: Analyze customer questions" description="Identify lost sales, affected products, and recovery actions." />
              <input type="hidden" name="intent" value="analyze" />
              <input type="hidden" name="actionKey" value={makeActionKey("run:analysis")} />
              <Button
                variant="primary"
                submit
                loading={loadingFor(makeActionKey("run:analysis"))}
                disabled={recentMessageCount === 0 || loadingFor(makeActionKey("run:analysis"))}
                onClick={() => markPending(makeActionKey("run:analysis"))}
              >
                Run analysis
              </Button>
              {recentMessageCount === 0 ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  Add chats, emails, support messages, or order notes before running analysis.
                </Text>
              ) : null}
            </BlockStack>
          </Form>
        </Card>
      </BlockStack>
    </AppPage>
  );
}
