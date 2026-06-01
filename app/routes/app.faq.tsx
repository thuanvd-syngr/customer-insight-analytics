import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import { Badge, BlockStack, Box, Button, Card, Divider, InlineGrid, InlineStack, Text, TextField } from "@shopify/polaris";

import {
  AppPage,
  EmptyInsight,
  formatNumber,
  ListSkeleton,
  moneyRange,
  PriorityBadge,
  SectionHeader,
  StickyActionBar,
  TrendIndicator,
  type PriorityLevel,
} from "~/components";
import prisma from "~/db.server";
import { getAIProvider } from "~/lib/ai";
import { getDevPlanOverride, resolvePlan, type PlanId } from "~/lib/billing";
import { PLANS } from "~/lib/billing/plans";
import { faqToHtml, generateFaqFromOpportunity, type GeneratedFaq } from "~/lib/faq-generator";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { publishGeneratedFaq, rollbackGeneratedFaq } from "~/lib/shopify-publish.server";
import { EMPTY_INSIGHT, type KeywordGroupId } from "~/lib/types";
import { authenticate } from "~/shopify.server";

type GeneratedFaqRecord = {
  id: string;
  groupId: string | null;
  productTitle: string | null;
  question: string;
  answerText: string;
  answerHtml: string;
  status: string;
  publishTarget: string;
  publishRef: string | null;
  error: string | null;
  createdAt: Date | string;
  publishedAt: Date | string | null;
};

const defaultFaqStats = {
  total: 0,
  generated: 0,
  prepared: 0,
};

function generatedFaqModel() {
  return (prisma as typeof prisma & {
    generatedFaq?: {
      findMany: typeof prisma.generatedFaq.findMany;
      create: typeof prisma.generatedFaq.create;
      updateMany: typeof prisma.generatedFaq.updateMany;
      update: typeof prisma.generatedFaq.update;
    };
  }).generatedFaq;
}

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

function parseSaved(value?: string): GeneratedFaq[] {
  if (!value) return [];
  try {
    return JSON.parse(value) as GeneratedFaq[];
  } catch {
    return [];
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { shop, plan } = await getContext(request);
    const faqModel = generatedFaqModel();
    const [run, savedSetting, generatedFaqs] = await Promise.all([
      getLatestRun(prisma, shop.id),
      prisma?.appSetting
        ? prisma.appSetting.findUnique({ where: { shopId_key: { shopId: shop.id, key: "savedFaqs" } } })
        : null,
      faqModel
        ? faqModel.findMany({ where: { shopId: shop.id }, orderBy: { createdAt: "desc" }, take: 50 })
        : Promise.resolve([] as GeneratedFaqRecord[]),
    ]);
    const insight = parseRun(run) ?? EMPTY_INSIGHT;
    const provider = getAIProvider();
    const stats = {
      total: generatedFaqs.length,
      generated: generatedFaqs.filter((faq) => !["prepared", "published"].includes(faq.status)).length,
      prepared: generatedFaqs.filter((faq) => ["prepared", "published"].includes(faq.status)).length,
    };
    return json({
      opportunities: insight.faqOpportunities,
      questionOpportunities: insight.questionOpportunities,
      contentGaps: insight.contentGaps,
      saved: parseSaved(savedSetting?.value),
      generatedFaqs,
      stats,
      canGenerate: PLANS[plan].features.faqGeneration || plan === "free" || plan === "starter",
      aiProvider: provider.id,
      aiConfigured: provider.isConfigured(),
      storageReady: Boolean(faqModel),
    });
  } catch (error) {
    console.error("FAQ route loader failed", error);
    const provider = getAIProvider();
    return json({
      opportunities: [],
      questionOpportunities: [],
      contentGaps: [],
      saved: [],
      generatedFaqs: [] as GeneratedFaqRecord[],
      stats: defaultFaqStats,
      canGenerate: true,
      aiProvider: provider.id,
      aiConfigured: provider.isConfigured(),
      storageReady: false,
    });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { shop, plan, admin } = await getContext(request);
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "generate");
    const groupId = String(form.get("groupId") ?? "shipping") as KeywordGroupId;
    const question = String(form.get("question") ?? "What should customers know before buying?");
    const productId = String(form.get("productId") ?? "") || null;
    const productTitle = String(form.get("productTitle") ?? "") || null;
    const faq = generateFaqFromOpportunity({
      groupId,
      label: groupId,
      count: 1,
      trend7: 0,
      severity: "medium",
      revenueImpact: 0,
      lowEstimate: 0,
      highEstimate: 0,
      priorityScore: 50,
      actionType: "faq",
      suggestedAction: `Add ${groupId} FAQ`,
    });
    const generated = { ...faq, question };

    if (intent === "download") {
      return new Response(faqToHtml(generated), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `attachment; filename="${groupId}-faq.html"`,
        },
      });
    }

    if (intent === "prepare" || intent === "bulk-prepare") {
      const faqModel = generatedFaqModel();
      const id = String(form.get("id") ?? "");
      if (faqModel) {
        await faqModel.updateMany({
          where: {
            shopId: shop.id,
            ...(intent === "prepare" ? { id } : { status: { in: ["draft", "generated"] } }),
          },
          data: { status: "prepared", publishedAt: null },
        });
      }
      return redirect("/app/faq");
    }

    if (intent === "publish") {
      const id = String(form.get("id") ?? "");
      const target = String(form.get("publishTarget") ?? "metafield") as "metafield" | "append_description" | "faq_block";
      await publishGeneratedFaq({ db: prisma, admin, shopId: shop.id, faqId: id, target });
      return redirect("/app/faq");
    }

    if (intent === "rollback") {
      const id = String(form.get("id") ?? "");
      await rollbackGeneratedFaq({ db: prisma, admin, shopId: shop.id, faqId: id });
      return redirect("/app/faq");
    }

    if (intent === "save") {
      const faqModel = generatedFaqModel();
      if (faqModel) {
        await faqModel.create({
          data: {
            shopId: shop.id,
            groupId,
            productId,
            productTitle,
            question: generated.question,
            answerText: generated.answer,
            answerHtml: faqToHtml(generated),
            source: generated.source,
            status: "generated",
          },
        });
      }
      if (prisma?.appSetting) {
        const existing = await prisma.appSetting.findUnique({
          where: { shopId_key: { shopId: shop.id, key: "savedFaqs" } },
        });
        const saved = parseSaved(existing?.value);
        saved.unshift(generated);
        await prisma.appSetting.upsert({
          where: { shopId_key: { shopId: shop.id, key: "savedFaqs" } },
          update: { value: JSON.stringify(saved.slice(0, 25)) },
          create: { shopId: shop.id, key: "savedFaqs", value: JSON.stringify(saved.slice(0, 25)) },
        });
      }
      return redirect("/app/faq");
    }

    if (intent === "bulk-generate") {
      const faqModel = generatedFaqModel();
      const run = await getLatestRun(prisma, shop.id);
      const insight = parseRun(run) ?? EMPTY_INSIGHT;
      const source = insight.contentGaps.length
        ? insight.contentGaps.flatMap((gap) =>
            gap.missingSections.slice(0, 2).map((section) => ({
              groupId: groupIdFromSection(section),
              question: `What should customers know about ${section.toLowerCase()} for ${gap.productTitle}?`,
              rationale: `Product content is missing ${section}.`,
              frequency: gap.contentGapScore,
              hasContent: false,
              priority: gap.contentGapScore,
              productId: gap.productId,
              productTitle: gap.productTitle,
            })),
          )
        : insight.faqOpportunities.length
        ? insight.faqOpportunities
        : insight.questionOpportunities;
      if (faqModel) {
        await Promise.all(source.slice(0, 8).map((item) => {
          const draft = generateFaqFromOpportunity(item);
          const itemProductId = (item as { productId?: unknown }).productId;
          const itemProductTitle = (item as { productTitle?: unknown }).productTitle;
          return faqModel.create({
            data: {
              shopId: shop.id,
              groupId: item.groupId,
              productId: typeof itemProductId === "string" ? itemProductId : null,
              productTitle: typeof itemProductTitle === "string" ? itemProductTitle : null,
              question: draft.question,
              answerText: draft.answer,
              answerHtml: faqToHtml(draft),
              source: draft.source,
              status: "generated",
            },
          });
        }));
      }
      return redirect("/app/faq");
    }

    if (!PLANS[plan].features.faqGeneration && plan !== "free" && plan !== "starter") {
      return json({ error: "FAQ generation is available on Growth and Pro." }, { status: 403 });
    }
    return redirect("/app/faq");
  } catch (error) {
    console.error("FAQ route action failed", error);
    return redirect("/app/faq");
  }
}

function groupIdFromSection(section: string): KeywordGroupId {
  const value = section.toLowerCase();
  if (value.includes("shipping")) return "shipping";
  if (value.includes("delivery")) return "delivery";
  if (value.includes("return")) return "return";
  if (value.includes("refund")) return "refund";
  if (value.includes("size")) return "size";
  if (value.includes("ingredient")) return "ingredient";
  if (value.includes("comparison") || value.includes("quality")) return "compare";
  if (value.includes("payment")) return "payment";
  if (value.includes("stock")) return "stock";
  if (value.includes("usage")) return "usage";
  return "shipping";
}

/** Presentational: derive a priority level from either opportunity shape. */
function levelFor(item: { priority?: number; severity?: PriorityLevel; frequency?: number; count?: number }): PriorityLevel {
  if (item.severity) return item.severity;
  const score = item.priority ?? 0;
  if (score >= 67) return "high";
  if (score >= 34) return "medium";
  return "low";
}

export default function FaqGenerator() {
  const {
    opportunities,
    questionOpportunities,
    contentGaps,
    saved,
    generatedFaqs,
    stats,
    aiProvider,
    aiConfigured,
    storageReady,
  } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  if (navigation.state === "loading") return <ListSkeleton />;

  const source = opportunities.length ? opportunities : questionOpportunities;
  const items = source.slice(0, 8);

  return (
    <AppPage
      title="Revenue Recovery Content Engine"
      subtitle="Turn buying objections into content that recovers revenue."
      primaryAction={
        items.length > 0 ? (
          <Form method="post">
            <input type="hidden" name="intent" value="bulk-generate" />
            <input type="hidden" name="groupId" value={source[0].groupId} />
            <input type="hidden" name="question" value={generateFaqFromOpportunity(source[0]).question} />
            <Button submit variant="primary">Create Revenue Recovery Content</Button>
          </Form>
        ) : (
          <Button url="/app/import" variant="primary">Add customer questions</Button>
        )
      }
      secondaryAction={<Button url="/app/import">Run analysis</Button>}
    >
      <BlockStack gap="500">
        <Card>
          <InlineStack align="space-between" blockAlign="center" wrap={false}>
            <BlockStack gap="050">
              <Text as="p" variant="headingSm">
                Content engine
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Rule-based answers with optional AI rewrites when configured
              </Text>
            </BlockStack>
            <InlineStack gap="200" blockAlign="center">
              <Badge tone="info">{`${formatNumber(items.length)} content opportunities`}</Badge>
              <Badge tone="success">{`${formatNumber(stats.prepared)} prepared`}</Badge>
              <Badge tone={aiConfigured ? "success" : "info"}>
                {aiConfigured && aiProvider !== "mock" ? `AI provider: ${aiProvider}` : "Rule-based mode"}
              </Badge>
              {!storageReady ? <Badge tone="warning">History storage unavailable</Badge> : null}
            </InlineStack>
          </InlineStack>
        </Card>

        <BlockStack gap="300">
          {contentGaps.length > 0 ? (
            <>
              <SectionHeader
                title="What should I fix today?"
                description="Product content gaps ranked by customer demand, expected impact, and time to fix."
              />
              <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                {contentGaps.slice(0, 4).map((gap) => {
                  const firstSection = gap.missingSections[0] ?? "FAQ";
                  const fixGroupId = groupIdFromSection(firstSection);
                  return (
                    <Card key={`${gap.productId ?? gap.productTitle}-${firstSection}`}>
                      <BlockStack gap="200">
                        <InlineStack align="space-between" blockAlign="start" wrap={false} gap="200">
                          <BlockStack gap="050">
                            <Text as="h3" variant="headingMd">{gap.productTitle}</Text>
                            <Text as="p" variant="bodySm" tone="subdued">{firstSection}</Text>
                          </BlockStack>
                          <Badge tone={gap.contentGapScore >= 67 ? "critical" : gap.contentGapScore >= 34 ? "warning" : "info"}>
                            {`${gap.contentGapScore}/100 gap`}
                          </Badge>
                        </InlineStack>
                        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="200">
                          <BlockStack gap="050">
                            <Text as="span" variant="bodySm" tone="subdued">Expected impact</Text>
                            <Text as="span" variant="headingSm">{gap.expectedImpact ?? moneyRange(gap.estimatedLow, gap.estimatedHigh)}</Text>
                          </BlockStack>
                          <BlockStack gap="050">
                            <Text as="span" variant="bodySm" tone="subdued">Time to fix</Text>
                            <Text as="span" variant="headingSm">{gap.timeToFix ?? "20 min"}</Text>
                          </BlockStack>
                          <BlockStack gap="050">
                            <Text as="span" variant="bodySm" tone="subdued">Missing</Text>
                            <Text as="span" variant="headingSm">{gap.missingSections.slice(0, 2).join(", ")}</Text>
                          </BlockStack>
                        </InlineGrid>
                        <Form method="post">
                          <input type="hidden" name="intent" value="save" />
                          <input type="hidden" name="groupId" value={fixGroupId} />
                          <input type="hidden" name="productId" value={gap.productId ?? ""} />
                          <input type="hidden" name="productTitle" value={gap.productTitle} />
                          <input type="hidden" name="question" value={`What should customers know about ${firstSection.toLowerCase()} for ${gap.productTitle}?`} />
                          <Button submit variant="primary">Generate Fix</Button>
                        </Form>
                      </BlockStack>
                    </Card>
                  );
                })}
              </InlineGrid>
            </>
          ) : null}

          <SectionHeader
              title="Revenue Recovery Content"
            description="Content opportunities ranked by question demand, affected customers, revenue impact, products impacted, and draft status."
          />

          {items.length === 0 ? (
            <Card>
              <EmptyInsight
                heading="Revenue recovery content opportunities will appear here"
                primaryActionLabel="Add customer questions"
                primaryActionUrl="/app/import"
                secondaryActionLabel="View dashboard"
                secondaryActionUrl="/app"
              >
                <p>Analyze customer questions to identify lost sales and create recovery content drafts.</p>
              </EmptyInsight>
            </Card>
          ) : (
            <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
              {items.map((item) => {
                const generated = generateFaqFromOpportunity(item);
                const level = levelFor(item);
                const trend = "trend7" in item ? item.trend7 : undefined;
                const frequency = "frequency" in item ? item.frequency : "count" in item ? item.count : undefined;
                const questionOpportunity = questionOpportunities.find((entry) => entry.groupId === item.groupId);
                const impactedProducts = contentGaps
                  .filter((gap) => gap.customerQuestions.some((question) =>
                    question.toLowerCase().includes(item.groupId),
                  ) || gap.missingSections.some((section) =>
                    section.toLowerCase().includes(item.groupId),
                  ))
                  .slice(0, 3);
                return (
                  <Card key={`${item.groupId}-${generated.question}`}>
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="start" wrap={false} gap="200">
                        <Text as="h3" variant="headingMd">
                          {generated.question}
                        </Text>
                        <PriorityBadge level={level} withLabel />
                      </InlineStack>

                      <InlineStack gap="300" blockAlign="center">
                        <Badge>{item.groupId}</Badge>
                        {typeof frequency === "number" ? (
                          <Text as="span" variant="bodySm" tone="subdued">
                            {`${formatNumber(frequency)} mentions`}
                          </Text>
                        ) : null}
                        {typeof trend === "number" ? <TrendIndicator value={trend} suffix="7d" /> : null}
                        <Badge tone="info">Generated status: draft</Badge>
                      </InlineStack>

                      <InlineGrid columns={{ xs: 1, sm: 3 }} gap="200">
                        <BlockStack gap="050">
                          <Text as="span" variant="bodySm" tone="subdued">
                            Question demand
                          </Text>
                          <Text as="span" variant="headingSm">
                            {typeof frequency === "number" ? formatNumber(frequency) : "Ready to analyze customer questions"}
                          </Text>
                        </BlockStack>
                        <BlockStack gap="050">
                          <Text as="span" variant="bodySm" tone="subdued">
                            Revenue impact
                          </Text>
                          <Text as="span" variant="headingSm">
                            {questionOpportunity
                              ? `${moneyRange(questionOpportunity.lowEstimate, questionOpportunity.highEstimate)}/mo`
                              : "Connect orders"}
                          </Text>
                        </BlockStack>
                        <BlockStack gap="050">
                          <Text as="span" variant="bodySm" tone="subdued">
                            Products impacted
                          </Text>
                          <Text as="span" variant="headingSm">
                            {impactedProducts.length > 0 ? formatNumber(impactedProducts.length) : "Storewide"}
                          </Text>
                        </BlockStack>
                      </InlineGrid>

                      <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                        <Text as="p" variant="bodySm" tone="subdued">
                          Answer preview
                        </Text>
                        <Box paddingBlockStart="100">
                          <Text as="p" variant="bodyMd">
                            {generated.answer}
                          </Text>
                        </Box>
                      </Box>

                      <TextField
                        label="Answer (editable draft)"
                        labelHidden
                        value={generated.answer}
                        multiline={4}
                        autoComplete="off"
                        readOnly
                      />

                      <Divider />

                      <InlineStack gap="200" wrap>
                        <Form method="post">
                          <input type="hidden" name="intent" value="save" />
                          <input type="hidden" name="groupId" value={item.groupId} />
                          <input type="hidden" name="question" value={generated.question} />
                          <Button submit variant="primary">
                            Create Content
                          </Button>
                        </Form>
                        <Button disabled>Edit</Button>
                        <Form method="post">
                          <input type="hidden" name="intent" value="download" />
                          <input type="hidden" name="groupId" value={item.groupId} />
                          <input type="hidden" name="question" value={generated.question} />
                          <Button submit>Preview</Button>
                        </Form>
                        <Form method="post">
                          <input type="hidden" name="intent" value="save" />
                          <input type="hidden" name="groupId" value={item.groupId} />
                          <input type="hidden" name="question" value={generated.question} />
                          <Button submit>Prepare publish draft</Button>
                        </Form>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                );
              })}
            </InlineGrid>
          )}
        </BlockStack>

        {generatedFaqs.length > 0 ? (
          <BlockStack gap="300">
            <SectionHeader
              title="Generated and Prepared Content"
              description="Recovery content drafts ready for merchant review before Shopify publishing"
              trailing={<Badge tone="success">{`${formatNumber(generatedFaqs.length)} drafts`}</Badge>}
            />
            <Card>
              <BlockStack gap="300">
                {generatedFaqs.map((faq, index) => (
                  <BlockStack key={faq.id} gap="100">
                    {index > 0 ? <Divider /> : null}
                    <InlineStack gap="200" blockAlign="center" align="space-between">
                      <InlineStack gap="200" blockAlign="center">
                        <Badge>{faq.groupId ?? "faq"}</Badge>
                        <Badge tone={["prepared", "published"].includes(faq.status) ? "success" : "info"}>
                          {faq.status}
                        </Badge>
                        {faq.productTitle ? <Badge>{faq.productTitle}</Badge> : null}
                      </InlineStack>
                      <InlineStack gap="200">
                      {!["prepared", "published"].includes(faq.status) ? (
                        <Form method="post">
                          <input type="hidden" name="intent" value="prepare" />
                          <input type="hidden" name="id" value={faq.id} />
                          <Button submit size="slim">
                            Prepare publish draft
                          </Button>
                        </Form>
                      ) : null}
                      {["prepared", "failed"].includes(faq.status) ? (
                        <>
                          <Form method="post">
                            <input type="hidden" name="intent" value="publish" />
                            <input type="hidden" name="id" value={faq.id} />
                            <input type="hidden" name="publishTarget" value="metafield" />
                            <Button submit size="slim" variant="primary">Publish metafield</Button>
                          </Form>
                          <Form method="post">
                            <input type="hidden" name="intent" value="publish" />
                            <input type="hidden" name="id" value={faq.id} />
                            <input type="hidden" name="publishTarget" value="append_description" />
                            <Button submit size="slim">Append description</Button>
                          </Form>
                        </>
                      ) : null}
                      {faq.status === "published" && faq.publishTarget === "append_description" ? (
                        <Form method="post">
                          <input type="hidden" name="intent" value="rollback" />
                          <input type="hidden" name="id" value={faq.id} />
                          <Button submit size="slim">Rollback</Button>
                        </Form>
                      ) : null}
                      </InlineStack>
                    </InlineStack>
                    <BlockStack gap="100">
                      <Text as="h3" variant="headingSm">
                        {faq.question}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {faq.answerText}
                      </Text>
                      {faq.error ? (
                        <Text as="p" variant="bodySm" tone="critical">
                          {faq.error}
                        </Text>
                      ) : null}
                    </BlockStack>
                  </BlockStack>
                ))}
              </BlockStack>
            </Card>
          </BlockStack>
        ) : saved.length > 0 ? (
          <BlockStack gap="300">
            <SectionHeader
              title="Saved FAQs"
              description="Legacy saved drafts"
              trailing={<Badge tone="success">{`${formatNumber(saved.length)} saved`}</Badge>}
            />
            <Card>
              <BlockStack gap="300">
                {saved.map((faq, index) => (
                  <BlockStack key={`${faq.topic}-${index}`} gap="100">
                    {index > 0 ? <Divider /> : null}
                    <InlineStack gap="200" blockAlign="center">
                      <Badge>{faq.topic}</Badge>
                      <Text as="h3" variant="headingSm">
                        {faq.question}
                      </Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {faq.answer}
                    </Text>
                  </BlockStack>
                ))}
              </BlockStack>
            </Card>
          </BlockStack>
        ) : null}

        {items.length > 0 ? (
          <StickyActionBar align="space-between">
            <Text as="span" variant="bodySm" tone="subdued">
              {`${formatNumber(items.length)} opportunities ready for recovery content`}
            </Text>
            <InlineStack gap="200">
              <Form method="post">
                <input type="hidden" name="intent" value="download" />
                <input type="hidden" name="groupId" value={source[0].groupId} />
                <input type="hidden" name="question" value={generateFaqFromOpportunity(source[0]).question} />
                <Button submit>Preview HTML</Button>
              </Form>
              {generatedFaqs.some((faq) => !["prepared", "published"].includes(faq.status)) ? (
                <Form method="post">
                  <input type="hidden" name="intent" value="bulk-prepare" />
                  <Button submit>Prepare publish draft</Button>
                </Form>
              ) : null}
              <Form method="post">
                <input type="hidden" name="intent" value="bulk-generate" />
                <input type="hidden" name="groupId" value={source[0].groupId} />
                <input type="hidden" name="question" value={generateFaqFromOpportunity(source[0]).question} />
                <Button submit variant="primary">
                  Create Revenue Recovery Content
                </Button>
              </Form>
            </InlineStack>
          </StickyActionBar>
        ) : null}
      </BlockStack>
    </AppPage>
  );
}
