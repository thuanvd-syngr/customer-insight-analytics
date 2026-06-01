import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Badge,
  Bleed,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  InlineGrid,
  InlineStack,
  Layout,
  Page,
  Text,
} from "@shopify/polaris";

import {
  BarChart,
  type BarDatum,
  DetailSkeleton,
  EmptyInsight,
  formatNumber,
  MetricCard,
  money,
  moneyRange,
  PriorityBadge,
  ScoreGauge,
  SectionHeader,
  StickyActionBar,
  TrendChart,
  TrendIndicator,
} from "~/components";
import prisma from "~/db.server";
import { dailyVolume, normalizeText, STOP_WORDS, tokenize } from "~/lib/engine";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { EMPTY_INSIGHT } from "~/lib/types";
import { authenticate } from "~/shopify.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  const insight = parseRun(await getLatestRun(prisma, shop.id)) ?? EMPTY_INSIGHT;
  const id = decodeURIComponent(params.id ?? "");
  const product = insight.productConfusion.find(
    (item) => item.productId === id || item.productTitle === id,
  );
  const relatedQuestions = insight.questionOpportunities.filter((item) =>
    product?.topGroups.includes(item.groupId),
  );
  const contentGap = insight.contentGaps.find(
    (item) => item.productId === id || item.productTitle === id,
  );

  // Real "questions over time" for this product: count stored customer messages
  // that mention the product title, bucketed by day over the last 14 days.
  let timeline: Array<{ date: string; count: number }> = [];
  if (product) {
    const terms = [
      ...new Set(
        tokenize(product.productTitle, { removeStopWords: true, minLength: 4 }).filter(
          (term) => !STOP_WORDS.has(term),
        ),
      ),
    ];
    if (terms.length > 0) {
      const rows = await prisma.importedMessage.findMany({
        where: { shopId: shop.id },
        select: { id: true, content: true, occurredAt: true, source: true },
        orderBy: { occurredAt: "desc" },
        take: 3000,
      });
      const matched = rows
        .filter((row) => {
          const normalized = normalizeText(row.content);
          return terms.some((term) => normalized.includes(term));
        })
        .map((row) => ({
          id: row.id,
          content: row.content,
          occurredAt: row.occurredAt,
          source: row.source,
        }));
      timeline = dailyVolume(matched, new Date(), 14);
    }
  }

  return json({ product, relatedQuestions, timeline, contentGap });
}

function confusionTone(score: number) {
  if (score >= 50) return "critical" as const;
  if (score >= 25) return "warning" as const;
  return "success" as const;
}

export default function ProductConfusionDetail() {
  const { product, relatedQuestions, timeline, contentGap } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  if (navigation.state === "loading") return <DetailSkeleton />;

  if (!product) {
    return (
      <Page
        title="Product confusion"
        backAction={{ content: "Products", url: "/app/products" }}
      >
        <Card>
          <EmptyInsight
            heading="Product insight not found"
            primaryActionLabel="Back to products"
            primaryActionUrl="/app/products"
          >
            <p>Run a fresh analysis to rebuild this product&apos;s confusion details.</p>
          </EmptyInsight>
        </Card>
      </Page>
    );
  }

  const totalRevenueImpact = relatedQuestions.reduce(
    (sum, item) => sum + item.revenueImpact,
    0,
  );
  const tone = confusionTone(product.confusionScore);

  const hasTimeline = timeline.some((point) => point.count > 0);

  // Real question volume by topic, sorted by frequency.
  const questionBars: BarDatum[] = [...relatedQuestions]
    .sort((a, b) => b.count - a.count)
    .map((item) => ({
      label: item.label,
      value: item.count,
      tone: item.severity === "high" ? "critical" : item.severity === "medium" ? "warning" : "info",
    }));

  const examples: Array<{ key: string; label: string; quote: string }> = relatedQuestions
    .filter((item) => item.exampleQuote)
    .map((item) => ({ key: item.groupId, label: item.label, quote: item.exampleQuote as string }));
  if (product.exampleQuote) {
    examples.unshift({ key: "__product", label: product.productTitle, quote: product.exampleQuote });
  }

  // Highest-impact question drives the primary sticky action.
  const topQuestion = [...relatedQuestions].sort(
    (a, b) => b.revenueImpact - a.revenueImpact,
  )[0];

  return (
    <Page
      title={product.productTitle}
      subtitle="Where customers get stuck before buying"
      backAction={{ content: "Products", url: "/app/products" }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
              <MetricCard
                title="Potential monthly revenue at risk"
                value={
                  contentGap && contentGap.estimatedHigh > 0
                    ? moneyRange(contentGap.estimatedLow, contentGap.estimatedHigh)
                    : totalRevenueImpact > 0
                      ? money(totalRevenueImpact)
                      : "Connect orders to unlock recovery estimates"
                }
                sublabel="Sum of revenue impact across related questions"
                tone="critical"
                helpText="Estimated monthly revenue tied to the questions driving this product's confusion."
              />
              <MetricCard
                title="Customer questions"
                value={formatNumber(product.mentionCount)}
                sublabel="Mentions in the analysis window"
                tone="info"
              />
              <Card>
                <BlockStack gap="200" inlineAlign="center">
                  <ScoreGauge
                    score={product.confusionScore}
                    tone={tone}
                    size="small"
                    label="Confusion score"
                    caption="Higher means more recovery priority"
                  />
                </BlockStack>
              </Card>
            </InlineGrid>

            {hasTimeline ? (
              <Card>
                <BlockStack gap="300">
                  <SectionHeader
                    title="Questions over time"
                    description="Daily customer questions mentioning this product (last 14 days)"
                  />
                  <TrendChart points={timeline} tone="critical" />
                </BlockStack>
              </Card>
            ) : null}

            <Card>
              <BlockStack gap="400">
                <SectionHeader
                  title="Content gap analysis"
                  description="Missing product content compared with customer questions"
                  trailing={
                    contentGap ? (
                      <Badge tone={contentGap.contentGapScore >= 67 ? "critical" : "warning"}>
                        {`${contentGap.contentGapScore}/100 gap score`}
                      </Badge>
                    ) : undefined
                  }
                />
                {contentGap && contentGap.missingSections.length > 0 ? (
                  <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                    <BlockStack gap="150">
                      <Text as="span" variant="bodySm" tone="subdued">
                        Missing sections
                      </Text>
                      <InlineStack gap="100">
                        {contentGap.missingSections.map((section) => (
                          <Badge key={section} tone="warning">
                            {section}
                          </Badge>
                        ))}
                      </InlineStack>
                    </BlockStack>
                    <BlockStack gap="150">
                      <Text as="span" variant="bodySm" tone="subdued">
                        Suggested fixes
                      </Text>
                      {contentGap.recommendedActions.map((action) => (
                        <Text as="span" variant="bodySm" key={action}>
                          {action}
                        </Text>
                      ))}
                    </BlockStack>
                  </InlineGrid>
                ) : (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Sync Shopify content and run analysis to see missing product sections.
                  </Text>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <SectionHeader
                  title="Questions customers ask"
                  description="Topics driving confusion for this product, by volume"
                  trailing={
                    <Badge tone="info">{`${formatNumber(relatedQuestions.length)} topics`}</Badge>
                  }
                />
                {questionBars.length === 0 ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Add customer questions to connect buyer questions to this product.
                  </Text>
                ) : (
                  <>
                    <BarChart data={questionBars} />
                    <Bleed marginInline="400">
                      <Divider />
                    </Bleed>
                    <BlockStack gap="300">
                      {[...relatedQuestions]
                        .sort((a, b) => b.revenueImpact - a.revenueImpact)
                        .map((item) => (
                          <InlineStack
                            key={item.groupId}
                            align="space-between"
                            blockAlign="center"
                            wrap={false}
                          >
                            <BlockStack gap="050">
                              <Text as="span" variant="bodyMd" fontWeight="medium">
                                {item.label}
                              </Text>
                              <InlineStack gap="200" blockAlign="center">
                                <Text as="span" variant="bodySm" tone="subdued">
                                  {`${formatNumber(item.count)} customers asked`}
                                </Text>
                                <TrendIndicator value={item.trend7} suffix="vs last week" />
                              </InlineStack>
                            </BlockStack>
                            <InlineStack gap="200" blockAlign="center">
                              <PriorityBadge level={item.severity} />
                              <Text as="span" variant="bodyMd" fontWeight="semibold">
                                {item.highEstimate > 0 ? `${moneyRange(item.lowEstimate, item.highEstimate)}/mo` : "Connect orders"}
                              </Text>
                            </InlineStack>
                          </InlineStack>
                        ))}
                    </BlockStack>
                  </>
                )}
              </BlockStack>
            </Card>

            {examples.length > 0 ? (
              <Card>
                <BlockStack gap="300">
                  <SectionHeader
                    title="What customers are saying"
                    description="Real messages behind this product's confusion"
                  />
                  <BlockStack gap="300">
                    {examples.map((example) => (
                      <Box
                        key={`${example.key}-${example.quote.slice(0, 24)}`}
                        background="bg-surface-secondary"
                        padding="300"
                        borderRadius="200"
                        borderInlineStartWidth="050"
                        borderColor="border-emphasis"
                      >
                        <BlockStack gap="100">
                          <Text as="p" variant="bodyMd">
                            {`"${example.quote}"`}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {example.label}
                          </Text>
                        </BlockStack>
                      </Box>
                    ))}
                  </BlockStack>
                </BlockStack>
              </Card>
            ) : null}
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <SectionHeader title="Top confusion topics" />
                <InlineStack gap="200">
                  {product.topGroups.length === 0 ? (
                    <Text as="span" variant="bodySm" tone="subdued">
                      Run analysis
                    </Text>
                  ) : (
                    product.topGroups.map((topic) => <Badge key={topic}>{topic}</Badge>)
                  )}
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <SectionHeader
                  title="Suggested fixes"
                  description="Close these gaps to recover revenue"
                />
                {relatedQuestions.length === 0 ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    Run analysis to generate product recovery fixes.
                  </Text>
                ) : (
                  <BlockStack gap="300">
                    {relatedQuestions.map((item) => (
                      <BlockStack gap="150" key={item.groupId}>
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="span" variant="bodySm" fontWeight="medium">
                            {item.label}
                          </Text>
                          <PriorityBadge level={item.severity} />
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {item.suggestedAction}
                        </Text>
                        <Form method="post" action="/app/faq">
                          <input type="hidden" name="intent" value="save" />
                          <input type="hidden" name="groupId" value={item.groupId} />
                          <input
                            type="hidden"
                            name="question"
                            value={`What should customers know about ${item.label.toLowerCase()}?`}
                          />
                          <Button submit size="slim">
                            Generate FAQ
                          </Button>
                        </Form>
                      </BlockStack>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      {topQuestion ? (
        <StickyActionBar align="space-between">
          <BlockStack gap="025">
            <Text as="span" variant="bodySm" tone="subdued">
              Recommended next step
            </Text>
            <Text as="span" variant="bodyMd" fontWeight="medium">
              {`Generate an FAQ for "${topQuestion.label}"`}
            </Text>
          </BlockStack>
          <Form method="post" action="/app/faq">
            <input type="hidden" name="intent" value="save" />
            <input type="hidden" name="groupId" value={topQuestion.groupId} />
            <input
              type="hidden"
              name="question"
              value={`What should customers know about ${topQuestion.label.toLowerCase()}?`}
            />
            <Button submit variant="primary">
              Generate FAQ
            </Button>
          </Form>
        </StickyActionBar>
      ) : null}
    </Page>
  );
}
