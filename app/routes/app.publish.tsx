import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect, useState } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Divider,
  InlineGrid,
  InlineStack,
  Text,
} from "@shopify/polaris";

import prisma from "~/db.server";
import {
  ACTION_TIMEOUT_MS,
  CONTENT_PUBLISH_SCOPES,
  PRODUCT_FAQ_PUBLISH_SCOPES,
  formActionKey,
  makeActionKey,
  missingScopes,
} from "~/lib/action-loading";
import { getDevPlanOverride, resolvePlan, type PlanId } from "~/lib/billing";
import { PLANS } from "~/lib/billing/plans";
import { generateFaqFromOpportunity } from "~/lib/faq-generator";
import { hasPublishAbuse, hasXss, sanitizeText } from "~/lib/sanitize";
import { logUsage } from "~/lib/log-usage.server";
import { getDelegate, safeCount } from "~/lib/prisma-safe";
import {
  ALL_PAGE_CONTENT_TYPES,
  BLOG_GROUP_LABELS,
  DEFAULT_FAQS,
  PAGE_TYPE_DESCRIPTIONS,
  PAGE_TYPE_GROUPS,
  PAGE_TYPE_LABELS,
  faqsForPageType,
  type FaqItem,
  type PageContentType,
} from "~/lib/publish";
import {
  deleteShopifyArticle,
  deleteShopifyPage,
  getPublishedContent,
  getPublishedCounts,
  publishFaqAsBlogArticle,
  publishFaqAsShopifyPage,
} from "~/lib/publish/shopify-publisher.server";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { publishGeneratedFaq } from "~/lib/shopify-publish.server";
import { EMPTY_INSIGHT } from "~/lib/types";
import { authenticate } from "~/shopify.server";
import { AppPage, SectionHeader, formatNumber } from "~/components";
import { hasActionableRecoveryInsight } from "~/lib/insight-guards";

async function getContext(request: Request) {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  const plan = resolvePlan({
    activePlanId: shop.plan as PlanId,
    devOverride: getDevPlanOverride(),
    devOverrideEnabled: process.env.ENABLE_DEV_PLAN_OVERRIDE === "true",
    isProduction: process.env.NODE_ENV === "production",
  });
  return { shop, plan, admin, session };
}

function buildFaqsForType(type: PageContentType, insight: typeof EMPTY_INSIGHT): FaqItem[] {
  const groups = PAGE_TYPE_GROUPS[type];
  const fromInsight: FaqItem[] = [];
  for (const groupId of groups) {
    const opp =
      insight.faqOpportunities.find((o) => o.groupId === groupId) ??
      insight.questionOpportunities.find((o) => o.groupId === groupId);
    if (opp) {
      const faq = generateFaqFromOpportunity(opp);
      fromInsight.push({ question: faq.question, answer: faq.answer });
    }
  }
  return faqsForPageType(type, fromInsight);
}

function buildFaqsForGroup(groupId: string, insight: typeof EMPTY_INSIGHT): FaqItem[] {
  const opp =
    insight.faqOpportunities.find((o) => o.groupId === groupId) ??
    insight.questionOpportunities.find((o) => o.groupId === groupId);
  if (opp) {
    const faq = generateFaqFromOpportunity(opp);
    return [{ question: faq.question, answer: faq.answer }, ...(DEFAULT_FAQS[groupId]?.slice(1) ?? [])];
  }
  return DEFAULT_FAQS[groupId] ?? [];
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { shop, plan, session } = await getContext(request);
    const canPublish = PLANS[plan].features.faqPublishing;
    const faqModel = getDelegate(prisma, "generatedFaq");
    const bulkJob = getDelegate(prisma, "bulkJob");
    const [latestRun, published, counts, generatedFaqs, recentBulkJobs] = await Promise.all([
      getLatestRun(prisma, shop.id),
      getPublishedContent(prisma, shop.id),
      getPublishedCounts(prisma, shop.id),
      faqModel?.findMany
        ? faqModel.findMany({ where: { shopId: shop.id, status: { in: ["draft", "generated", "prepared", "failed"] } }, orderBy: { createdAt: "desc" }, take: 25 })
        : [],
      bulkJob?.findMany
        ? bulkJob.findMany({ where: { shopId: shop.id, jobType: "publish_pages" }, orderBy: { createdAt: "desc" }, take: 3 })
        : [],
    ]);
    const latestInsight = latestRun ? parseRun(latestRun) : null;
    const hasInsight = hasActionableRecoveryInsight(latestInsight);
    const insight = hasInsight ? (latestInsight ?? EMPTY_INSIGHT) : EMPTY_INSIGHT;
    const pagePreview = hasInsight ? ALL_PAGE_CONTENT_TYPES.map((contentType) => ({
      contentType,
      label: PAGE_TYPE_LABELS[contentType],
      faqCount: buildFaqsForType(contentType, insight).length,
    })) : [];
    const blogPreview = hasInsight ? BLOG_GROUPS.slice(0, 4).map((groupId) => ({
      groupId,
      label: BLOG_GROUP_LABELS[groupId] ?? groupId,
      faqCount: buildFaqsForGroup(groupId, insight).length,
    })) : [];
    const productFaqPreview = (generatedFaqs as Array<{ id: string; productId?: string | null; question: string; status: string }>).filter((faq) => faq.productId);
    const missingContentScopes = missingScopes(session.scope, CONTENT_PUBLISH_SCOPES);
    const missingProductFaqScopes = missingScopes(session.scope, PRODUCT_FAQ_PUBLISH_SCOPES);
    return json({
      hasInsight,
      published,
      counts,
      pagePreview,
      blogPreview,
      productFaqPreview,
      recentBulkJobs,
      diagnostics: {
        scopes: {
          granted: (session.scope ?? "").split(",").map((scope) => scope.trim()).filter(Boolean),
          requiredContent: CONTENT_PUBLISH_SCOPES,
          requiredProductFaq: PRODUCT_FAQ_PUBLISH_SCOPES,
          missingContent: missingContentScopes,
          missingProductFaq: missingProductFaqScopes,
        },
        writeContentScope: missingContentScopes.length === 0,
        shopDomain: shop.shopDomain,
        onlineStorePublishCapability: counts.pages > 0 || published.some((item) => item.status === "published"),
        targetTypes: ["page", "blog", "product_faq"],
      },
      storeName: shop.shopDomain.replace(".myshopify.com", ""),
      canPublish,
      loadError: null,
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Publish loader failed", error);
    return json({
      hasInsight: false,
      published: [],
      counts: { total: 0, pages: 0, productFaqs: 0, blogs: 0 },
      pagePreview: ALL_PAGE_CONTENT_TYPES.map((contentType) => ({ contentType, label: PAGE_TYPE_LABELS[contentType], faqCount: 0 })),
      blogPreview: BLOG_GROUPS.slice(0, 4).map((groupId) => ({ groupId, label: BLOG_GROUP_LABELS[groupId] ?? groupId, faqCount: 0 })),
      productFaqPreview: [],
      recentBulkJobs: [],
      diagnostics: {
        scopes: {
          granted: [],
          requiredContent: CONTENT_PUBLISH_SCOPES,
          requiredProductFaq: PRODUCT_FAQ_PUBLISH_SCOPES,
          missingContent: CONTENT_PUBLISH_SCOPES,
          missingProductFaq: PRODUCT_FAQ_PUBLISH_SCOPES,
        },
        writeContentScope: false,
        shopDomain: "",
        onlineStorePublishCapability: false,
        targetTypes: ["page", "blog", "product_faq"],
      },
      storeName: "",
      canPublish: false,
      loadError: "Publish data is loading. Refresh in a moment — your published pages are safe.",
    });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const { shop, plan, admin, session } = await getContext(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  const contentScopeMissing = missingScopes(session.scope, CONTENT_PUBLISH_SCOPES);
  // PRODUCT_FAQ_PUBLISH_SCOPES is enforced inside publish-all-recovery only;
  // there is no standalone product_faq publish intent.
  const productFaqScopeMissing = missingScopes(session.scope, PRODUCT_FAQ_PUBLISH_SCOPES);
  const requiresContentPublish = ["publish-page", "publish-blog", "publish-all-recovery", "publish-retry"].includes(intent);
  if (requiresContentPublish && !PLANS[plan].features.faqPublishing) {
    return json({ error: "Publishing recovery content is available on Growth and Pro plans." }, { status: 403 });
  }
  if (requiresContentPublish && contentScopeMissing.length > 0) {
    return json({
      error: `Missing Shopify scope${contentScopeMissing.length === 1 ? "" : "s"}: ${contentScopeMissing.join(", ")}. Update app scopes, redeploy, then reinstall or reauthorize the app.`,
    }, { status: 403 });
  }
  if (requiresContentPublish) {
    const latestRun = await getLatestRun(prisma, shop.id);
    if (!hasActionableRecoveryInsight(latestRun ? parseRun(latestRun) : null)) {
      return json({
        error: "Import customer questions that reveal buying objections, then run analysis before publishing recovery content.",
      }, { status: 400 });
    }
  }

  // Rate-limit check shared by all publish intents (safe: table may not exist yet)
  const recentPublishCount = await safeCount(prisma, "publishedContent", {
    where: { shopId: shop.id, publishedAt: { gte: new Date(Date.now() - 86_400_000) } },
  });

  if (intent === "publish-page") {
    const rawType = String(form.get("contentType") ?? "");
    if (!ALL_PAGE_CONTENT_TYPES.includes(rawType as PageContentType)) {
      return json({ error: "Invalid content type." }, { status: 400 });
    }
    const contentType = rawType as PageContentType;
    const latestRun = await getLatestRun(prisma, shop.id);
    const insight = parseRun(latestRun) ?? EMPTY_INSIGHT;
    const faqs = buildFaqsForType(contentType, insight);
    const faqContent = faqs.map((f) => `${f.question} ${f.answer}`).join(" ");
    if (hasPublishAbuse(faqContent, recentPublishCount)) {
      return json({ error: "Content flagged: possible XSS or publish rate limit exceeded." }, { status: 400 });
    }
    const result = await publishFaqAsShopifyPage({
      db: prisma,
      admin,
      shopId: shop.id,
      contentType,
      faqs,
    });
    if (!result.ok) return json({ error: result.error ?? "Publish failed." });
    await logUsage(prisma, shop.id, "content_published", { contentType });
    return redirect("/app/publish");
  }

  if (intent === "publish-blog") {
    const groupId = String(form.get("groupId") ?? "shipping");
    const rawStoreName = String(form.get("storeName") ?? "");
    if (hasXss(rawStoreName)) {
      return json({ error: "Store name contains invalid content." }, { status: 400 });
    }
    const storeName = sanitizeText(rawStoreName, 100);
    const latestRun = await getLatestRun(prisma, shop.id);
    const insight = parseRun(latestRun) ?? EMPTY_INSIGHT;
    const faqs = buildFaqsForGroup(groupId, insight);
    const faqContent = faqs.map((f) => `${f.question} ${f.answer}`).join(" ");
    if (hasPublishAbuse(faqContent, recentPublishCount)) {
      return json({ error: "Content flagged: possible XSS or publish rate limit exceeded." }, { status: 400 });
    }
    const result = await publishFaqAsBlogArticle({
      db: prisma,
      admin,
      shopId: shop.id,
      groupId,
      faqs,
      storeName: storeName || undefined,
    });
    if (!result.ok) return json({ error: result.error ?? "Publish failed." });
    await logUsage(prisma, shop.id, "content_published", { contentType: "blog_article", groupId });
    return redirect("/app/publish");
  }

  if (intent === "publish-all-recovery") {
    const confirmed = String(form.get("confirm") ?? "") === "yes";
    if (!confirmed) return json({ error: "Preview and confirm before publishing recovery content." }, { status: 400 });
    const latestRun = await getLatestRun(prisma, shop.id);
    const insight = parseRun(latestRun) ?? EMPTY_INSIGHT;
    const bulkJob = getDelegate(prisma, "bulkJob");
    const bulkItem = getDelegate(prisma, "bulkJobItem");
    const revenueEvent = getDelegate(prisma, "revenueEvent");
    const faqModel = getDelegate(prisma, "generatedFaq");
    const started = new Date();
    const pageTypes = ALL_PAGE_CONTENT_TYPES;
    const blogGroups = BLOG_GROUPS.slice(0, 4);
    const productFaqs = faqModel?.findMany
      ? await faqModel.findMany({ where: { shopId: shop.id, status: { in: ["draft", "generated", "prepared", "failed"] }, productId: { not: null } }, orderBy: { createdAt: "desc" }, take: 10 })
      : [];
    const totalItems = pageTypes.length + blogGroups.length + productFaqs.length;
    const job = bulkJob?.create
      ? await bulkJob.create({
          data: {
            shopId: shop.id,
            jobType: "publish_pages",
            status: "running",
            filterType: "storewide",
            totalItems,
            startedAt: started,
          },
        })
      : null;
    let success = 0;
    let failed = 0;
    const errors: string[] = [];
    async function recordItem(itemId: string, itemType: string, ok: boolean, result?: string | null, error?: string | null) {
      if (!job?.id || !bulkItem?.create) return;
      await bulkItem.create({
        data: {
          jobId: job.id,
          itemId,
          itemType,
          status: ok ? "completed" : "failed",
          result: result ?? null,
          error: error ?? null,
        },
      });
    }
    for (const contentType of pageTypes) {
      const faqs = buildFaqsForType(contentType, insight);
      const result = await publishFaqAsShopifyPage({ db: prisma, admin, shopId: shop.id, contentType, faqs });
      if (result.ok) success++; else { failed++; errors.push(result.error ?? `${PAGE_TYPE_LABELS[contentType]} failed`); }
      await recordItem(contentType, "page", result.ok, result.resourceTitle, result.error);
    }
    for (const groupId of blogGroups) {
      const faqs = buildFaqsForGroup(groupId, insight);
      const result = await publishFaqAsBlogArticle({
        db: prisma,
        admin,
        shopId: shop.id,
        groupId,
        faqs,
        storeName: shop.shopDomain.replace(".myshopify.com", ""),
      });
      if (result.ok) success++; else { failed++; errors.push(result.error ?? `${groupId} blog failed`); }
      await recordItem(groupId, "blog", result.ok, result.resourceTitle, result.error);
    }
    for (const faq of productFaqs as Array<{ id: string; question: string }>) {
      if (productFaqScopeMissing.length > 0) {
        failed++;
        const error = `Missing Shopify scope${productFaqScopeMissing.length === 1 ? "" : "s"} for product FAQ publish: ${productFaqScopeMissing.join(", ")}`;
        errors.push(error);
        await recordItem(faq.id, "product_faq", false, faq.question, error);
        continue;
      }
      const result = await publishGeneratedFaq({ db: prisma, admin, shopId: shop.id, faqId: faq.id, target: "metafield" });
      const ok = result.status === "published";
      if (ok) success++; else { failed++; errors.push(result.error ?? `${faq.question} failed`); }
      await recordItem(faq.id, "product_faq", ok, faq.question, result.error);
    }
    if (bulkJob?.update && job?.id) {
      await bulkJob.update({
        where: { id: job.id },
        data: {
          status: failed > 0 ? "failed" : "completed",
          processedItems: success,
          failedItems: failed,
          resultJson: JSON.stringify({ success, failed, errors: errors.slice(0, 10) }),
          error: failed > 0 ? errors[0] ?? "Some recovery content failed to publish." : null,
          completedAt: new Date(),
        },
      });
    }
    if (revenueEvent?.create && success > 0) {
      await revenueEvent.create({
        data: {
          shopId: shop.id,
          eventType: "content_published",
          description: `Published ${success} recovery content assets`,
          refId: job?.id ?? null,
          refType: "bulk_job",
          lowEstimate: success * 75,
          highEstimate: success * 250,
        },
      });
    }
    await logUsage(prisma, shop.id, "content_published", { mode: "publish_all_recovery", success, failed });
    return redirect("/app/publish");
  }

  if (intent === "delete") {
    const id = String(form.get("id") ?? "");
    const resourceId = String(form.get("resourceId") ?? "");
    const contentType = String(form.get("contentType") ?? "");
    if (!id || !resourceId) return json({ error: "Missing id or resourceId." }, { status: 400 });
    if (contentType === "blog_article") {
      await deleteShopifyArticle({ db: prisma, admin, publishedContentId: id, resourceId });
    } else {
      await deleteShopifyPage({ db: prisma, admin, publishedContentId: id, resourceId });
    }
    return redirect("/app/publish");
  }

  return redirect("/app/publish");
}

const BLOG_GROUPS = Object.keys(BLOG_GROUP_LABELS).slice(0, 6);

function contentTypeTone(type: PageContentType): "info" | "success" | "warning" {
  if (type === "faq_page") return "success";
  if (type === "return_page" || type === "shipping_page") return "info";
  return "warning";
}

export default function PublishHub() {
  const { hasInsight, published, counts, pagePreview, blogPreview, productFaqPreview, recentBulkJobs, diagnostics, storeName, canPublish, loadError } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
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
  const actionError = actionData && "error" in actionData ? actionData.error : null;

  const activePublished = published.filter((p): p is NonNullable<typeof p> => p != null && p.status === "published");
  const failedPublished = published.filter((p): p is NonNullable<typeof p> => p != null && p.status === "failed");
  const contentPublishDisabled = diagnostics.scopes.missingContent.length > 0 || !hasInsight || !canPublish;

  return (
    <AppPage
      title="Publish Recovery Content"
      subtitle="One click to publish FAQ pages, policy pages, and blog articles directly to your Shopify store."
      primaryAction={<Button url={hasInsight ? "/app/faq" : "/app/import"} variant="primary">{hasInsight ? "Generate Content First" : "Import Customer Questions"}</Button>}
      secondaryAction={<Button url="/app">Back to Dashboard</Button>}
    >
      <BlockStack gap="600">
        {loadError ? <Banner tone="info" title="Content loading"><p>{loadError}</p></Banner> : null}
        {actionError ? (
          <Banner tone="warning" title="Publish did not complete">
            <p>{actionError}</p>
            <p>Your store data is safe. Check your Shopify store connection and try again.</p>
          </Banner>
        ) : null}
        {timeoutWarning ? (
          <Banner tone="warning" title="Action took longer than expected">
            <p>Action took longer than expected. You can safely retry.</p>
          </Banner>
        ) : null}

        {!hasInsight ? (
          <Banner tone="info" title="Run analysis first for personalized content">
            <p>
              The publish engine generates page content from your actual customer questions.
              Import customer questions and run analysis before publishing recovery content.
            </p>
            <Button url="/app/import" variant="primary">Import Customer Questions</Button>
          </Banner>
        ) : null}
        {!canPublish ? (
          <Banner tone="warning" title="Growth or Pro plan required">
            <p>Publishing to Shopify is disabled on Free and Starter. Upgrade before pushing pages, blog articles, or product FAQs live.</p>
            <Button url="/app/billing" variant="primary">Manage Plan</Button>
          </Banner>
        ) : null}

        <div className="cia-metric-strip">
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Published Assets</div>
            <Text as="p" variant="headingLg">{formatNumber(counts.total)}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Pages Published</div>
            <Text as="p" variant="headingLg">{formatNumber(counts.pages)}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">FAQs Published</div>
            <Text as="p" variant="headingLg">{formatNumber(counts.productFaqs)}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Blog Articles</div>
            <Text as="p" variant="headingLg">{formatNumber(counts.blogs)}</Text>
          </div>
        </div>

        {hasInsight ? (
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="start" wrap={false}>
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Publish All Recovery Content</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Preview the recovery batch, confirm, then publish pages, blogs, FAQs, and product FAQs. Failed items are tracked and can be retried by running the batch again.
                </Text>
              </BlockStack>
              <Badge tone="warning">Preview required</Badge>
            </InlineStack>
            <InlineGrid columns={{ xs: 1, md: 3 }} gap="300">
              <BlockStack gap="100">
                <Text as="p" variant="headingSm">Pages</Text>
                {pagePreview.map((item) => (
                  <Text key={item.contentType} as="p" variant="bodySm">{`${item.label} · ${item.faqCount} FAQs`}</Text>
                ))}
              </BlockStack>
              <BlockStack gap="100">
                <Text as="p" variant="headingSm">Blogs</Text>
                {blogPreview.map((item) => (
                  <Text key={item.groupId} as="p" variant="bodySm">{`${item.label} Guide · ${item.faqCount} FAQs`}</Text>
                ))}
              </BlockStack>
              <BlockStack gap="100">
                <Text as="p" variant="headingSm">Product FAQs</Text>
                <Text as="p" variant="bodySm">{`${formatNumber(productFaqPreview.length)} product FAQ drafts ready`}</Text>
                <Text as="p" variant="bodySm" tone="subdued">Draft-only FAQs without a product remain unpublished.</Text>
              </BlockStack>
            </InlineGrid>
            <Form method="post">
              <input type="hidden" name="intent" value="publish-all-recovery" />
              <input type="hidden" name="confirm" value="yes" />
              <input type="hidden" name="actionKey" value={makeActionKey("publish:all-recovery")} />
              <Button
                submit
                variant="primary"
                loading={loadingFor(makeActionKey("publish:all-recovery"))}
                disabled={contentPublishDisabled || loadingFor(makeActionKey("publish:all-recovery"))}
                onClick={() => markPending(makeActionKey("publish:all-recovery"))}
              >
                Confirm and Publish All Recovery Content
              </Button>
            </Form>
            {recentBulkJobs.length > 0 ? (
              <BlockStack gap="100">
                <Text as="p" variant="headingSm">Recent publish batches</Text>
                {recentBulkJobs.map((job: { id: string; status: string; processedItems: number; failedItems: number; createdAt: string | Date }) => (
                  <InlineStack key={job.id} gap="200" blockAlign="center">
                    <Badge tone={job.status === "completed" ? "success" : job.status === "failed" ? "critical" : "info"}>{job.status}</Badge>
                    <Text as="span" variant="bodySm">{`${formatNumber(job.processedItems)} success · ${formatNumber(job.failedItems)} failed · ${new Date(job.createdAt).toLocaleDateString()}`}</Text>
                  </InlineStack>
                ))}
              </BlockStack>
            ) : null}
          </BlockStack>
        </Card>
        ) : null}

        <Card>
          <BlockStack gap="200">
            <SectionHeader title="Publish Diagnostics" description="Use this when a page, blog, or product FAQ publish fails." />
            <InlineGrid columns={{ xs: 1, md: 4 }} gap="300">
              <BlockStack gap="050">
                <Text as="p" variant="bodySm" tone="subdued">Content scopes</Text>
                <Badge tone={diagnostics.writeContentScope ? "success" : "critical"}>{diagnostics.writeContentScope ? "Granted" : "Missing"}</Badge>
                {diagnostics.scopes.missingContent.length > 0 ? (
                  <Text as="p" variant="bodySm" tone="critical">{`Missing: ${diagnostics.scopes.missingContent.join(", ")}`}</Text>
                ) : null}
              </BlockStack>
              <BlockStack gap="050">
                <Text as="p" variant="bodySm" tone="subdued">Product FAQ scopes</Text>
                <Badge tone={diagnostics.scopes.missingProductFaq.length === 0 ? "success" : "warning"}>
                  {diagnostics.scopes.missingProductFaq.length === 0 ? "Granted" : "Partial"}
                </Badge>
                {diagnostics.scopes.missingProductFaq.length > 0 ? (
                  <Text as="p" variant="bodySm" tone="critical">{`Missing: ${diagnostics.scopes.missingProductFaq.join(", ")}`}</Text>
                ) : null}
              </BlockStack>
              <BlockStack gap="050">
                <Text as="p" variant="bodySm" tone="subdued">Publish capability</Text>
                <Badge tone={diagnostics.onlineStorePublishCapability ? "success" : "info"}>{diagnostics.onlineStorePublishCapability ? "Verified" : "Not verified yet"}</Badge>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="p" variant="bodySm" tone="subdued">Store status</Text>
                <Text as="p" variant="bodySm">{diagnostics.shopDomain || "Unknown"}</Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="p" variant="bodySm" tone="subdued">Theme status</Text>
                <Text as="p" variant="bodySm">Theme audit available</Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="p" variant="bodySm" tone="subdued">Content status</Text>
                <Text as="p" variant="bodySm">{`${formatNumber(counts.total)} published assets`}</Text>
              </BlockStack>
              <BlockStack gap="050">
                <Text as="p" variant="bodySm" tone="subdued">Target types</Text>
                <Text as="p" variant="bodySm">{diagnostics.targetTypes.join(", ")}</Text>
              </BlockStack>
            </InlineGrid>
            {diagnostics.scopes.missingContent.length > 0 ? (
              <Banner tone="warning" title="Publishing is disabled until scopes are updated">
                <p>Required content publish scopes are missing. Add the scopes in Shopify app configuration, redeploy, and reauthorize the app.</p>
              </Banner>
            ) : null}
          </BlockStack>
        </Card>

        {hasInsight ? (
        <BlockStack gap="300">
          <SectionHeader
            title="Publish Shopify Pages"
            description="Each page is published live to your Shopify store with FAQ schema markup for SEO."
          />
          <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
            {ALL_PAGE_CONTENT_TYPES.map((type) => {
              const alreadyPublished = activePublished.some((p) => p.contentType === type);
              return (
                <Card key={type}>
                  <BlockStack gap="200">
                    <InlineStack align="space-between" blockAlign="start" wrap={false}>
                      <Text as="h3" variant="headingSm">{PAGE_TYPE_LABELS[type]}</Text>
                      {alreadyPublished ? <Badge tone="success">Live</Badge> : null}
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {PAGE_TYPE_DESCRIPTIONS[type]}
                    </Text>
                    <Form method="post">
                      <input type="hidden" name="intent" value="publish-page" />
                      <input type="hidden" name="contentType" value={type} />
                      <input type="hidden" name="actionKey" value={makeActionKey("publish:page", type)} />
                      <Button
                        submit
                        loading={loadingFor(makeActionKey("publish:page", type))}
                        disabled={contentPublishDisabled || loadingFor(makeActionKey("publish:page", type))}
                        variant={alreadyPublished ? undefined : "primary"}
                        size="slim"
                        onClick={() => markPending(makeActionKey("publish:page", type))}
                      >
                        {alreadyPublished ? "Republish" : "Publish to Shopify"}
                      </Button>
                    </Form>
                  </BlockStack>
                </Card>
              );
            })}
          </InlineGrid>
        </BlockStack>
        ) : null}

        {hasInsight ? (
        <BlockStack gap="300">
          <SectionHeader
            title="Publish Blog Articles"
            description="Blog articles drive organic traffic and answer buying questions before shoppers leave."
          />
          <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
            {BLOG_GROUPS.map((groupId) => {
              const label = BLOG_GROUP_LABELS[groupId] ?? groupId;
              return (
                <Card key={groupId}>
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingSm">{label} Guide</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {`Article: "${label}: Your Questions Answered" — published to Customer Insights blog.`}
                    </Text>
                    <Form method="post">
                      <input type="hidden" name="intent" value="publish-blog" />
                      <input type="hidden" name="groupId" value={groupId} />
                      <input type="hidden" name="storeName" value={storeName} />
                      <input type="hidden" name="actionKey" value={makeActionKey("publish:blog", groupId)} />
                      <Button
                        submit
                        loading={loadingFor(makeActionKey("publish:blog", groupId))}
                        disabled={contentPublishDisabled || loadingFor(makeActionKey("publish:blog", groupId))}
                        size="slim"
                        onClick={() => markPending(makeActionKey("publish:blog", groupId))}
                      >
                        Publish Blog Article
                      </Button>
                    </Form>
                  </BlockStack>
                </Card>
              );
            })}
          </InlineGrid>
        </BlockStack>
        ) : null}

        {failedPublished.length > 0 ? (
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="critical">Failed publishes</Text>
              {failedPublished.map((item, index) => (
                <BlockStack key={item.id} gap="100">
                  {index > 0 ? <Divider /> : null}
                  <InlineStack gap="200" blockAlign="center" align="space-between">
                    <BlockStack gap="050">
                      <Text as="p" variant="bodySm">{item.resourceTitle}</Text>
                      <Text as="p" variant="bodySm" tone="subdued">{`Target: ${item.contentType.replace(/_/g, " ")} · Failed ${new Date(item.publishedAt).toLocaleString()}`}</Text>
                      <Text as="p" variant="bodySm" tone="critical">{item.error ?? "Unknown error"}</Text>
                    </BlockStack>
                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone="critical">Failed</Badge>
                      <Form method="post">
                        <input type="hidden" name="intent" value={item.contentType === "blog_article" ? "publish-blog" : "publish-page"} />
                        <input type="hidden" name="contentType" value={item.contentType} />
                        <input type="hidden" name="groupId" value={item.contentType.replace("_page", "")} />
                        <input type="hidden" name="storeName" value={storeName} />
                        <input type="hidden" name="actionKey" value={makeActionKey("publish:retry", item.id)} />
                        <Button
                          submit
                          size="slim"
                          loading={loadingFor(makeActionKey("publish:retry", item.id))}
                          disabled={contentPublishDisabled || loadingFor(makeActionKey("publish:retry", item.id))}
                          onClick={() => markPending(makeActionKey("publish:retry", item.id))}
                        >
                          Retry failed
                        </Button>
                      </Form>
                    </InlineStack>
                  </InlineStack>
                </BlockStack>
              ))}
            </BlockStack>
          </Card>
        ) : null}

        {activePublished.length > 0 ? (
          <BlockStack gap="300">
            <SectionHeader
              title="Published Assets"
              description="All content currently live on your Shopify store."
            />
            <Card>
              <BlockStack gap="200">
                {activePublished.map((item, index) => (
                  <BlockStack key={item.id} gap="100">
                    {index > 0 ? <Divider /> : null}
                    <InlineStack gap="200" blockAlign="center" align="space-between" wrap={false}>
                      <BlockStack gap="050">
                        <InlineStack gap="200" blockAlign="center">
                          <Badge tone="success">Live</Badge>
                          <Badge>{item.contentType.replace(/_/g, " ")}</Badge>
                        </InlineStack>
                        <Text as="p" variant="bodySm">{item.resourceTitle}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {`Published ${new Date(item.publishedAt).toLocaleDateString()}`}
                        </Text>
                      </BlockStack>
                      <InlineStack gap="200">
                        {item.resourceId ? (() => {
                          const numId = item.resourceId.replace(/^gid:\/\/shopify\/[A-Za-z]+\//, "");
                          const adminPath = item.contentType === "blog_article"
                            ? `articles/${numId}`
                            : `pages/${numId}`;
                          return (
                            <Button
                              url={`https://${storeName}.myshopify.com/admin/${adminPath}`}
                              target="_blank"
                              size="slim"
                            >
                              View in Shopify
                            </Button>
                          );
                        })() : null}
                        {item.resourceId ? (
                          <Form method="post">
                            <input type="hidden" name="intent" value="delete" />
                            <input type="hidden" name="id" value={item.id} />
                            <input type="hidden" name="resourceId" value={item.resourceId} />
                            <input type="hidden" name="contentType" value={item.contentType} />
                            <input type="hidden" name="actionKey" value={makeActionKey("publish:delete", item.id)} />
                            <Button
                              submit
                              tone="critical"
                              size="slim"
                              loading={loadingFor(makeActionKey("publish:delete", item.id))}
                              disabled={loadingFor(makeActionKey("publish:delete", item.id))}
                              onClick={() => markPending(makeActionKey("publish:delete", item.id))}
                            >
                              Delete from Shopify
                            </Button>
                          </Form>
                        ) : null}
                      </InlineStack>
                    </InlineStack>
                  </BlockStack>
                ))}
              </BlockStack>
            </Card>
          </BlockStack>
        ) : null}

        {activePublished.length === 0 && failedPublished.length === 0 ? (
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingMd">No content published yet</Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                {hasInsight
                  ? "Choose a content type above and click Publish. Content is added to your Shopify store immediately."
                  : "Import customer questions and run analysis before publishing recovery content."}
              </Text>
            </BlockStack>
          </Card>
        ) : null}
      </BlockStack>
    </AppPage>
  );
}
