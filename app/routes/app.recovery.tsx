import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect, useState } from "react";
import { Badge, Banner, BlockStack, Box, Button, Card, Divider, InlineGrid, InlineStack, Text } from "@shopify/polaris";

import {
  AppPage,
  EmptyInsight,
  ListSkeleton,
  SectionHeader,
  formatNumber,
  money,
  moneyRange,
} from "~/components";
import prisma from "~/db.server";
import { faqToHtml, generateFaqFromOpportunity } from "~/lib/faq-generator";
import { getDelegate } from "~/lib/prisma-safe";
import {
  APP_STORE_READINESS_AUDIT,
  CONTENT_PACKS,
  buildRecoveryPlan,
  buildRevenueTimelineV2,
  calculateRecoveryScoreImprovement,
  type GeneratedFaqLike,
  type PublishedCountsLike,
} from "~/lib/revenue-automation";
import { ACTION_TIMEOUT_MS, formActionKey, makeActionKey } from "~/lib/action-loading";
import { buildPageContent, PAGE_TYPE_LABELS, type PageContentType } from "~/lib/publish";
import { isReviewerMode, buildSampleInsight } from "~/lib/reviewer-mode.server";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { EMPTY_INSIGHT, normalizeInsightResult, type InsightResult, type KeywordGroupId } from "~/lib/types";
import { getPublishedCounts } from "~/lib/publish/shopify-publisher.server";
import { authenticate } from "~/shopify.server";
import { hasActionableRecoveryInsight } from "~/lib/insight-guards";

type PageDraft = {
  id: string;
  pageType: PageContentType;
  title: string;
  handle: string;
  groupId: string;
  status: "draft";
  createdAt: string;
};

type ActionResult = {
  summary?: {
    createdFaqs: number;
    pageDrafts: number;
    packInstalled?: string;
    sampleOnly?: boolean;
  };
  error?: string;
};

function parseJsonArray<T>(value?: string | null): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

async function loadContext(request: Request) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  return { shop, shopDomain: session.shop };
}

function generatedFaqDelegate() {
  return getDelegate(prisma, "generatedFaq");
}

async function createRecoveryDrafts(input: {
  shopId: string;
  insight: InsightResult;
  selectedPackId?: string;
}) {
  const faqModel = generatedFaqDelegate();
  const appSetting = getDelegate(prisma, "appSetting");
  const revenueEvent = getDelegate(prisma, "revenueEvent");
  const now = new Date();
  const pack = input.selectedPackId ? CONTENT_PACKS.find((item) => item.id === input.selectedPackId) : null;
  const groups = pack
    ? [pack.groupId]
    : (["shipping", "refund", "payment", "warranty"] as KeywordGroupId[]);
  const pageTypes: PageContentType[] = pack
    ? [pack.pageType]
    : ["shipping_page", "return_page", "payment_page", "warranty_page"];

  let createdFaqs = 0;
  if (faqModel?.create) {
    for (const groupId of groups) {
      const opportunity =
        input.insight.questionOpportunities.find((item) => item.groupId === groupId) ??
        input.insight.faqOpportunities.find((item) => item.groupId === groupId);
      if (pack) {
        for (const faq of pack.faqs.slice(0, 4)) {
          await faqModel.create({
            data: {
              shopId: input.shopId,
              groupId,
              question: faq.question,
              answerText: faq.answer,
              answerHtml: `<p>${faq.answer}</p>`,
              source: "rule",
              status: "draft",
            },
          });
          createdFaqs++;
        }
      } else if (opportunity) {
        const draft = generateFaqFromOpportunity({
          ...opportunity,
          label: "label" in opportunity ? opportunity.label : groupId,
          count: "count" in opportunity ? opportunity.count : opportunity.frequency,
          trend7: "trend7" in opportunity ? opportunity.trend7 : 0,
          severity: "severity" in opportunity ? opportunity.severity : "medium",
          revenueImpact: "revenueImpact" in opportunity ? opportunity.revenueImpact : 0,
          lowEstimate: "lowEstimate" in opportunity ? opportunity.lowEstimate : 0,
          highEstimate: "highEstimate" in opportunity ? opportunity.highEstimate : 0,
          priorityScore: "priorityScore" in opportunity ? opportunity.priorityScore : opportunity.priority,
          actionType: "faq",
          suggestedAction: "suggestedAction" in opportunity ? opportunity.suggestedAction : `Create ${groupId} FAQ`,
        });
        await faqModel.create({
          data: {
            shopId: input.shopId,
            groupId,
            question: draft.question,
            answerText: draft.answer,
            answerHtml: faqToHtml(draft),
            source: draft.source,
            status: "draft",
          },
        });
        createdFaqs++;
      }
    }
  }

  const existing = appSetting?.findUnique
    ? await appSetting.findUnique({ where: { shopId_key: { shopId: input.shopId, key: "recoveryPageDrafts" } } })
    : null;
  const currentDrafts = parseJsonArray<PageDraft>((existing as { value?: string } | null)?.value);
  const newDrafts = pageTypes.map((pageType) => {
    const page = buildPageContent(pageType, pack?.faqs ?? []);
    return {
      id: `${pageType}-${now.getTime()}`,
      pageType,
      title: page.title,
      handle: page.handle,
      groupId: (pack?.groupId ?? pageType.replace("_page", "")),
      status: "draft" as const,
      createdAt: now.toISOString(),
    };
  });
  if (appSetting?.upsert) {
    await appSetting.upsert({
      where: { shopId_key: { shopId: input.shopId, key: "recoveryPageDrafts" } },
      update: { value: JSON.stringify([...newDrafts, ...currentDrafts].slice(0, 30)) },
      create: { shopId: input.shopId, key: "recoveryPageDrafts", value: JSON.stringify(newDrafts) },
    });
  }
  if (revenueEvent?.create && (createdFaqs > 0 || newDrafts.length > 0)) {
    await revenueEvent.create({
      data: {
        shopId: input.shopId,
        eventType: "faq_created",
        description: pack ? `Installed ${pack.title}` : "Generated recovery plan drafts",
        refType: pack ? "content_pack" : "generated_faq",
        lowEstimate: (createdFaqs + newDrafts.length) * 40,
        highEstimate: (createdFaqs + newDrafts.length) * 120,
      },
    });
  }
  return { createdFaqs, pageDrafts: newDrafts.length, packInstalled: pack?.title };
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { shop } = await loadContext(request);
    const faqModel = generatedFaqDelegate();
    const appSetting = getDelegate(prisma, "appSetting");
    // Fetch gating data first so sampleMode can be derived before the rest.
    // sampleMode mirrors the dashboard guard: only activate when there is truly
    // no data, matching the behaviour in app._index.tsx.
    const [latestRun, existingLocalData] = await Promise.all([
      getLatestRun(prisma, shop.id),
      prisma.importedMessage.count({ where: { shopId: shop.id } }),
    ]);
    const latestInsight = latestRun ? parseRun(latestRun) : null;
    const hasAnalyzedQuestions = hasActionableRecoveryInsight(latestInsight);
    const sampleMode = !latestRun && existingLocalData === 0
      ? await isReviewerMode(prisma, shop.id)
      : false;
    const [publishedCounts, generatedFaqs, draftSetting] = await Promise.all([
      sampleMode ? Promise.resolve({ total: 5, pages: 3, blogs: 1, productFaqs: 1 }) : getPublishedCounts(prisma, shop.id),
      sampleMode
        ? Promise.resolve([
            { groupId: "shipping", status: "draft" },
            { groupId: "return", status: "published", productId: "sample-1" },
          ] as GeneratedFaqLike[])
        : faqModel?.findMany
          ? faqModel.findMany({ where: { shopId: shop.id }, orderBy: { createdAt: "desc" }, take: 100 })
          : Promise.resolve([]),
      sampleMode || !appSetting?.findUnique
        ? Promise.resolve(null)
        : appSetting.findUnique({ where: { shopId_key: { shopId: shop.id, key: "recoveryPageDrafts" } } }),
    ]);
    const insight = normalizeInsightResult(sampleMode ? buildSampleInsight() : (hasAnalyzedQuestions ? latestInsight : EMPTY_INSIGHT));
    const counts = publishedCounts as PublishedCountsLike;
    const faqs = generatedFaqs as GeneratedFaqLike[];
    const plan = buildRecoveryPlan({ insight, publishedCounts: counts, generatedFaqs: faqs });
    const score = calculateRecoveryScoreImprovement({ insight, publishedCounts: counts, generatedFaqs: faqs });
    return json({
      hasRun: hasAnalyzedQuestions || sampleMode,
      isSampleMode: sampleMode,
      insight,
      plan,
      score,
      timelineCards: buildRevenueTimelineV2({ generatedFaqs: faqs, publishedCounts: counts, plan }),
      pageDrafts: sampleMode
        ? [
            { id: "sample-shipping", pageType: "shipping_page", title: "Shipping Information & Delivery Times", handle: "shipping-information", groupId: "shipping", status: "draft", createdAt: new Date().toISOString() },
          ] as PageDraft[]
        : parseJsonArray<PageDraft>((draftSetting as { value?: string } | null)?.value),
      contentPacks: CONTENT_PACKS,
      auditItems: APP_STORE_READINESS_AUDIT,
      loadError: null,
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Recovery route loader failed", error);
    const insight = EMPTY_INSIGHT;
    const counts = { total: 0, pages: 0, blogs: 0, productFaqs: 0 };
    const plan = buildRecoveryPlan({ insight, publishedCounts: counts });
    return json({
      hasRun: false,
      isSampleMode: false,
      insight,
      plan,
      score: calculateRecoveryScoreImprovement({ insight, publishedCounts: counts }),
      timelineCards: buildRevenueTimelineV2({ publishedCounts: counts, plan }),
      pageDrafts: [] as PageDraft[],
      contentPacks: CONTENT_PACKS,
      auditItems: APP_STORE_READINESS_AUDIT,
      loadError: "Recovery automation data is loading. Refresh in a moment or run analysis again.",
    });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { shop } = await loadContext(request);
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "");
    const sampleMode = await isReviewerMode(prisma, shop.id);
    if (sampleMode) {
      return json<ActionResult>({ summary: { createdFaqs: 5, pageDrafts: 4, sampleOnly: true } });
    }
    const latestRun = await getLatestRun(prisma, shop.id);
    const latestInsight = latestRun ? parseRun(latestRun) : null;
    const hasAnalyzedQuestions = hasActionableRecoveryInsight(latestInsight);
    const insight = normalizeInsightResult(hasAnalyzedQuestions ? latestInsight : EMPTY_INSIGHT);
    if (intent === "generate-plan") {
      if (!hasAnalyzedQuestions) {
        return json<ActionResult>({
          error: "Run analysis with imported customer questions before generating a recovery plan.",
        });
      }
      return json<ActionResult>({ summary: await createRecoveryDrafts({ shopId: shop.id, insight }) });
    }
    if (intent === "install-pack") {
      if (!hasAnalyzedQuestions) {
        return json<ActionResult>({
          error: "Run analysis with imported customer questions before creating recovery drafts.",
        });
      }
      const packId = String(form.get("packId") ?? "");
      return json<ActionResult>({ summary: await createRecoveryDrafts({ shopId: shop.id, insight, selectedPackId: packId }) });
    }
    return redirect("/app/recovery");
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Recovery route action failed", error);
    return json<ActionResult>({ error: error instanceof Error ? error.message : "Recovery plan action failed." }, { status: 500 });
  }
}

function severityTone(severity: string): "critical" | "warning" | "info" {
  if (severity === "high") return "critical";
  if (severity === "medium") return "warning";
  return "info";
}

export default function RecoveryAutomation() {
  const {
    hasRun,
    isSampleMode,
    insight,
    plan,
    score,
    timelineCards,
    pageDrafts,
    contentPacks,
    auditItems,
    loadError,
  } = useLoaderData<typeof loader>();
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
  if (navigation.state === "loading") return <ListSkeleton />;
  const summary = actionData?.summary;
  const actionError = actionData?.error;
  const estimateCopy = "Estimate based on customer question frequency, content coverage, product count and benchmark conversion recovery models. Not actual revenue.";

  return (
    <AppPage
      title="Revenue Automation Engine"
      subtitle="One prioritized recovery plan, draft generation, content packs, and estimated recovery tracking."
      primaryAction={hasRun ? (
        <Form method="post">
          <input type="hidden" name="intent" value="generate-plan" />
          <input type="hidden" name="actionKey" value={makeActionKey("generate:recovery-plan")} />
          <Button
            submit
            variant="primary"
            loading={loadingFor(makeActionKey("generate:recovery-plan"))}
            disabled={loadingFor(makeActionKey("generate:recovery-plan"))}
            onClick={() => markPending(makeActionKey("generate:recovery-plan"))}
          >
            Generate Recovery Plan
          </Button>
        </Form>
      ) : <Button url="/app/import" variant="primary">Import Customer Questions</Button>}
      secondaryAction={<Button url="/app/publish">Publish Recovery Content</Button>}
    >
      <BlockStack gap="600">
        {isSampleMode ? (
          <Banner tone="info" title="Sample Data">
            <p>Reviewer Mode V2 is showing sample questions, products, opportunities, recovery plan, and published assets. No sample data is written to the database.</p>
          </Banner>
        ) : null}
        {loadError ? <Banner tone="info" title="Recovery data loading"><p>{loadError}</p></Banner> : null}
        {actionError ? <Banner tone="critical" title="Action failed"><p>{actionError}</p></Banner> : null}
        {timeoutWarning ? (
          <Banner tone="warning" title="Action took longer than expected">
            <p>Action took longer than expected. You can safely retry.</p>
          </Banner>
        ) : null}
        {summary ? (
          <Banner tone={summary.sampleOnly ? "info" : "success"} title={summary.sampleOnly ? "Sample recovery plan generated" : "Recovery plan drafts created"}>
            <p>
              {summary.sampleOnly
                ? "Sample-only preview complete. No database writes were made."
                : `${formatNumber(summary.createdFaqs)} FAQ drafts and ${formatNumber(summary.pageDrafts)} page drafts were stored. Nothing was published.`}
            </p>
            {summary.packInstalled ? <p>{`${summary.packInstalled} is ready for review.`}</p> : null}
          </Banner>
        ) : null}

        {!hasRun ? (
          <Card>
            <EmptyInsight
              heading="Import customer questions to build a recovery plan"
              primaryActionLabel="Import customer questions"
              primaryActionUrl="/app/import"
              secondaryActionLabel="Open theme audit"
              secondaryActionUrl="/app/theme-audit"
            >
              <p>Recovery automation needs imported chats, emails, support messages, or order notes before it can estimate revenue at risk.</p>
            </EmptyInsight>
          </Card>
        ) : null}

        {hasRun ? (
          <>
        <InlineGrid columns={{ xs: 1, md: 4 }} gap="400">
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">Revenue at Risk</Text>
              <Text as="p" variant="headingXl">{money(plan.revenueAtRisk)}/mo</Text>
              <Text as="p" variant="bodySm">Estimated monthly revenue exposed to unanswered buying questions.</Text>
              <Text as="p" variant="bodySm" tone="subdued">{estimateCopy}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">Recovery Score</Text>
              <InlineStack gap="200" blockAlign="center">
                <Text as="p" variant="headingXl">{score.currentScore}</Text>
                <Text as="p" variant="headingLg" tone="subdued">to</Text>
                <Text as="p" variant="headingXl">{score.potentialScore}</Text>
              </InlineStack>
              <Text as="p" variant="bodySm">Potential score after completing the recommended fixes.</Text>
              <Text as="p" variant="bodySm" tone="subdued">{estimateCopy}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">Expected Recovery</Text>
              <Text as="p" variant="headingXl">{moneyRange(plan.expectedRecoveryLow, plan.expectedRecoveryHigh)}/mo</Text>
              <Text as="p" variant="bodySm">Estimated attribution, not order-level attribution.</Text>
              <Text as="p" variant="bodySm" tone="subdued">{estimateCopy}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">Plan Progress</Text>
              <Text as="p" variant="headingXl">{`${plan.completedActions}/${plan.totalActions}`}</Text>
              <Text as="p" variant="bodySm">Actions completed across the current plan.</Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        <BlockStack gap="300">
          <SectionHeader title="Top Issues" description="One prioritized recovery plan based on revenue impact and actionability." />
          <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
            {plan.topIssues.map((issue) => (
              <Card key={issue.id}>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="start" wrap={false}>
                    <BlockStack gap="050">
                      <Text as="h3" variant="headingMd">{issue.title}</Text>
                      <Text as="p" variant="bodySm" tone="subdued">{`${formatNumber(issue.mentionCount)} customer mentions`}</Text>
                    </BlockStack>
                    <Badge tone={severityTone(issue.severity)}>{issue.severity}</Badge>
                  </InlineStack>
                  <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                    <Text as="p" variant="bodySm" tone="subdued">Estimated impact</Text>
                    <Text as="p" variant="headingLg">{money(issue.estimatedImpact)}/mo</Text>
                  </Box>
                  <BlockStack gap="200">
                    <Text as="p" variant="headingSm">Recommended</Text>
                    {issue.actions.map((action) => (
                      <InlineStack key={action.id} align="space-between" blockAlign="center" wrap={false}>
                        <Text as="span" variant="bodySm">{action.label}</Text>
                        <Button url={action.targetUrl} size="slim">{action.completed ? "View" : "Start"}</Button>
                      </InlineStack>
                    ))}
                  </BlockStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {`${issue.actions.filter((action) => action.completed).length}/${issue.actions.length} completed`}
                  </Text>
                </BlockStack>
              </Card>
            ))}
          </InlineGrid>
        </BlockStack>

        <Card>
          <BlockStack gap="300">
            <SectionHeader title="Score Factors" description="The score now reflects content progress, coverage, and unresolved gaps." />
            <InlineGrid columns={{ xs: 1, sm: 2, md: 5 }} gap="300">
              <Box><Text as="p" variant="bodySm" tone="subdued">Questions answered</Text><Text as="p" variant="headingMd">{formatNumber(score.factors.questionsAnswered)}</Text></Box>
              <Box><Text as="p" variant="bodySm" tone="subdued">Published assets</Text><Text as="p" variant="headingMd">{formatNumber(score.factors.publishedAssets)}</Text></Box>
              <Box><Text as="p" variant="bodySm" tone="subdued">Missing content</Text><Text as="p" variant="headingMd">{formatNumber(score.factors.missingContentCount)}</Text></Box>
              <Box><Text as="p" variant="bodySm" tone="subdued">FAQ coverage</Text><Text as="p" variant="headingMd">{score.factors.faqCoverage}%</Text></Box>
              <Box><Text as="p" variant="bodySm" tone="subdued">Competitor coverage</Text><Text as="p" variant="headingMd">{score.factors.competitorCoverage}%</Text></Box>
            </InlineGrid>
          </BlockStack>
        </Card>

        <BlockStack gap="300">
          <SectionHeader title="Revenue Timeline V2" description="Estimated attribution from content creation, publish activity, product fixes, and recovery progress." />
          <InlineGrid columns={{ xs: 1, md: 5 }} gap="300">
            {timelineCards.map((card) => (
              <Card key={card.type}>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">{card.label}</Text>
                  <Text as="p" variant="headingLg">{formatNumber(card.count)}</Text>
                  <Text as="p" variant="bodySm">{moneyRange(card.lowEstimate, card.highEstimate)}</Text>
                </BlockStack>
              </Card>
            ))}
          </InlineGrid>
        </BlockStack>

        <BlockStack gap="300">
          <SectionHeader title="Content Packs" description="Create reusable draft content. Nothing is published automatically; merchants review before publishing." />
          <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
            {contentPacks.map((pack) => (
              <Card key={pack.id}>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">{pack.title}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">{`${pack.faqs.length} FAQs, ${PAGE_TYPE_LABELS[pack.pageType]}, ${pack.schemaType} schema`}</Text>
                  <Text as="p" variant="bodySm">Creates drafts only. Nothing is published automatically.</Text>
                  <Text as="p" variant="bodySm" tone="subdued">Review the draft content before publishing it to Shopify.</Text>
                  <InlineStack gap="100">
                    {pack.suggestedPublishTargets.slice(0, 3).map((target) => <Badge key={target}>{target}</Badge>)}
                  </InlineStack>
                  <Form method="post">
                    <input type="hidden" name="intent" value="install-pack" />
                    <input type="hidden" name="packId" value={pack.id} />
                    <input type="hidden" name="actionKey" value={makeActionKey("install:content-pack", pack.id)} />
                    <Button
                      submit
                      loading={loadingFor(makeActionKey("install:content-pack", pack.id))}
                      disabled={loadingFor(makeActionKey("install:content-pack", pack.id))}
                      size="slim"
                      onClick={() => markPending(makeActionKey("install:content-pack", pack.id))}
                    >
                      Create Drafts
                    </Button>
                  </Form>
                </BlockStack>
              </Card>
            ))}
          </InlineGrid>
        </BlockStack>

        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <SectionHeader title="Stored Page Drafts" description="Draft metadata saved by the recovery plan engine. These are not published automatically." />
              {pageDrafts.length === 0 ? <Text as="p" variant="bodySm" tone="subdued">No page drafts yet.</Text> : null}
              {pageDrafts.slice(0, 6).map((draft, index) => (
                <BlockStack key={draft.id} gap="100">
                  {index > 0 ? <Divider /> : null}
                  <InlineStack align="space-between" blockAlign="center" wrap={false}>
                    <BlockStack gap="050">
                      <Text as="p" variant="bodySm">{draft.title}</Text>
                      <Text as="p" variant="bodySm" tone="subdued">{PAGE_TYPE_LABELS[draft.pageType]}</Text>
                    </BlockStack>
                    <Badge tone="info">Draft</Badge>
                  </InlineStack>
                </BlockStack>
              ))}
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <SectionHeader title="App Store Readiness Audit" description="Current Phase 18 review checks and mitigations." />
              {auditItems.map((item, index) => (
                <BlockStack key={item.route} gap="100">
                  {index > 0 ? <Divider /> : null}
                  <Text as="p" variant="headingSm">{item.route}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">{item.risk}</Text>
                  <Text as="p" variant="bodySm">{item.recommendedFix}</Text>
                </BlockStack>
              ))}
            </BlockStack>
          </Card>
        </InlineGrid>

        {insight.revenueOpportunity.monthlyAtRisk > 0 ? (
          <Banner tone="info" title={`You have ${money(insight.revenueOpportunity.monthlyAtRisk)}/mo revenue at risk.`}>
            <p>Publishing high-impact recovery content helps address buying objections. Results vary by store, traffic, and product category.</p>
          </Banner>
        ) : null}
          </>
        ) : null}
      </BlockStack>
    </AppPage>
  );
}
