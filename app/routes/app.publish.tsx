import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
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
import { getDevPlanOverride, resolvePlan, type PlanId } from "~/lib/billing";
import { generateFaqFromOpportunity } from "~/lib/faq-generator";
import { hasPublishAbuse, hasXss, sanitizeText } from "~/lib/sanitize";
import { logUsage } from "~/lib/log-usage.server";
import { safeCount } from "~/lib/prisma-safe";
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
import { EMPTY_INSIGHT } from "~/lib/types";
import { authenticate } from "~/shopify.server";
import { AppPage, SectionHeader, formatNumber } from "~/components";

async function getContext(request: Request) {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  const plan = resolvePlan({
    activePlanId: shop.plan as PlanId,
    devOverride: getDevPlanOverride(),
    devOverrideEnabled: process.env.ENABLE_DEV_PLAN_OVERRIDE === "true",
    isProduction: process.env.NODE_ENV === "production",
  });
  return { shop, plan, admin };
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
    const { shop } = await getContext(request);
    const [latestRun, published, counts] = await Promise.all([
      getLatestRun(prisma, shop.id),
      getPublishedContent(prisma, shop.id),
      getPublishedCounts(prisma, shop.id),
    ]);
    const insight = parseRun(latestRun) ?? EMPTY_INSIGHT;
    return json({
      hasInsight: Boolean(latestRun),
      published,
      counts,
      storeName: shop.shopDomain.replace(".myshopify.com", ""),
      loadError: null,
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Publish loader failed", error);
    return json({
      hasInsight: false,
      published: [],
      counts: { total: 0, pages: 0, productFaqs: 0, blogs: 0 },
      storeName: "",
      loadError: "Publish data is loading. Refresh in a moment — your published pages are safe.",
    });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const { shop, admin } = await getContext(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

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
  const { hasInsight, published, counts, storeName, loadError } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const actionError = actionData && "error" in actionData ? actionData.error : null;

  const activePublished = published.filter((p): p is NonNullable<typeof p> => p != null && p.status === "published");
  const failedPublished = published.filter((p): p is NonNullable<typeof p> => p != null && p.status === "failed");

  return (
    <AppPage
      title="Publish Recovery Content"
      subtitle="One click to publish FAQ pages, policy pages, and blog articles directly to your Shopify store."
      primaryAction={<Button url="/app/faq" variant="primary">Generate Content First</Button>}
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

        {!hasInsight ? (
          <Banner tone="info" title="Run analysis first for personalized content">
            <p>
              The publish engine generates page content from your actual customer questions.
              Run analysis to get personalized FAQs based on real buying friction data.
              Default FAQ content is used until analysis is available.
            </p>
            <Button url="/app/import" variant="primary">Run Analysis</Button>
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
                      <Button submit loading={busy} variant={alreadyPublished ? undefined : "primary"} size="slim">
                        {alreadyPublished ? "Republish" : "Publish to Shopify"}
                      </Button>
                    </Form>
                  </BlockStack>
                </Card>
              );
            })}
          </InlineGrid>
        </BlockStack>

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
                      <Button submit loading={busy} size="slim">Publish Blog Article</Button>
                    </Form>
                  </BlockStack>
                </Card>
              );
            })}
          </InlineGrid>
        </BlockStack>

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
                      <Text as="p" variant="bodySm" tone="critical">{item.error ?? "Unknown error"}</Text>
                    </BlockStack>
                    <Badge tone="critical">Failed</Badge>
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
                            <Button submit tone="critical" size="slim" loading={busy}>
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
                Choose a content type above and click Publish. Content is added to your Shopify store immediately.
              </Text>
            </BlockStack>
          </Card>
        ) : null}
      </BlockStack>
    </AppPage>
  );
}
