import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
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
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";

import prisma from "~/db.server";
import { generateContentWithFallback, isAIEnabled } from "~/lib/ai";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { EMPTY_INSIGHT } from "~/lib/types";
import type { CompetitorMentionResult } from "~/lib/types";
import { authenticate } from "~/shopify.server";
import {
  AppPage,
  BarChart,
  ChartCard,
  EmptyStateCard,
  KpiCard,
  ListSkeleton,
  SectionHeader,
  formatNumber,
  type BarDatum,
} from "~/components";
import {
  buildAllCompetitorIntelligence,
  INTENT_LABELS,
  type CompetitorIntelligence,
} from "~/lib/engine/competitor-intelligence";
import {
  publishFaqAsBlogArticle,
} from "~/lib/publish/shopify-publisher.server";

async function getCtx(request: Request) {
  const { session, admin } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  return { shop, session, admin };
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { shop } = await getCtx(request);
    const url = new URL(request.url);
    const debugMode = process.env.NODE_ENV !== "production" ? url.searchParams.get("debug") : null;
    const insight = parseRun(await getLatestRun(prisma, shop.id)) ?? EMPTY_INSIGHT;
    const intelligence = buildAllCompetitorIntelligence(insight.competitors);
    const totalRevenue = intelligence.reduce((sum, c) => sum + c.revenueAtRisk, 0);
    const totalSwitching = intelligence.filter((c) => c.switchingRisk > 40).length;

    return json({
      intelligence,
      competitors: insight.competitors,
      comparedProducts: insight.productConfusion.filter((p) =>
        p.topGroups.some((g) => g === "competitor" || g === "compare"),
      ),
      totalRevenue,
      totalSwitching,
      aiEnabled: isAIEnabled(),
      shopDomain: shop.shopDomain,
      debugInfo: debugMode === "competitors" ? { count: insight.competitors.length } : null,
      loadError: null,
    });
  } catch (error) {
    console.error("Competitors loader failed", error);
    return json({
      intelligence: [] as CompetitorIntelligence[],
      competitors: [] as CompetitorMentionResult[],
      comparedProducts: [],
      totalRevenue: 0,
      totalSwitching: 0,
      aiEnabled: false,
      shopDomain: "",
      debugInfo: null,
      loadError: "Data could not be loaded. Try refreshing or run analysis again.",
    });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { shop, session, admin } = await getCtx(request);
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "");
    const competitorName = String(form.get("competitorName") ?? "competitor");

    const saveFaqDraft = async (content: { title: string; plainText: string; html: string; source: string }) => {
      const faqModel = (prisma as unknown as {
        generatedFaq?: { create: (args: unknown) => Promise<unknown> };
      }).generatedFaq;
      if (faqModel?.create) {
        await faqModel.create({
          data: {
            shopId: shop.id,
            groupId: "competitor",
            question: content.title,
            answerText: content.plainText.slice(0, 2000),
            answerHtml: content.html,
            source: content.source,
            status: "generated",
          },
        });
      }
    };

    if (intent === "generate-comparison") {
      const content = await generateContentWithFallback({
        contentType: "competitor_comparison",
        competitorName,
        shopDomain: session.shop,
        storeName: session.shop.replace(".myshopify.com", ""),
      });
      await saveFaqDraft(content);
      return redirect("/app/faq");
    }

    if (intent === "generate-why-us") {
      const content = await generateContentWithFallback({
        contentType: "why_buy_from_us",
        competitorName,
        shopDomain: session.shop,
        storeName: session.shop.replace(".myshopify.com", ""),
      });
      await saveFaqDraft(content);
      return redirect("/app/faq");
    }

    if (intent === "publish-competitor-blog") {
      await publishFaqAsBlogArticle({
        db: prisma,
        admin,
        shopId: shop.id,
        groupId: "competitor",
        faqs: [
          {
            question: `Why do customers compare you to ${competitorName}?`,
            answer: `Customers evaluating ${competitorName} look at quality, pricing, policies, and support. Here's how we address each concern.`,
          },
          {
            question: `How do you compare to ${competitorName}?`,
            answer: `We focus on transparent policies, fast fulfillment, and product quality. Review product pages and policies to compare directly.`,
          },
        ],
        blogTitle: "Customer Insights",
      });
      return redirect("/app/publish");
    }

    return redirect("/app/competitors");
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Competitors action failed", error);
    return json({ error: error instanceof Error ? error.message : "Action failed." }, { status: 500 });
  }
}

const INTENT_BADGE: Record<string, "critical" | "warning" | "info" | "success"> = {
  switching: "critical",
  price: "warning",
  feature: "info",
  trust: "warning",
  comparison: "info",
  general: "info",
};

export default function CompetitorsPage() {
  const { intelligence, competitors, comparedProducts, totalRevenue, totalSwitching, aiEnabled, debugInfo, loadError } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();

  if (navigation.state === "loading") return <ListSkeleton />;

  const isEmpty = competitors.length === 0;
  const totalMentions = competitors.reduce((sum, c) => sum + c.count, 0);

  const bars: BarDatum[] = intelligence.map((c) => ({
    label: c.name,
    value: c.totalMentions,
    tone: c.switchingRisk >= 60 ? "critical" : c.switchingRisk >= 30 ? "warning" : "info",
  }));

  if (isEmpty) {
    return (
      <AppPage
        title="Competitor Intelligence"
        subtitle="Find competitors costing you buyers and generate response content."
        primaryAction={<Button url="/app/import" variant="primary">Add customer questions</Button>}
        secondaryAction={<Button url="/app/settings">Configure tracking</Button>}
      >
        {loadError ? <Banner tone="critical" title="Load error"><p>{loadError}</p></Banner> : null}
        <EmptyStateCard
          title="No competitor mentions detected"
          body="Add competitor brand names in Settings and import conversations that mention rivals."
          actionLabel="Configure competitor tracking"
          actionUrl="/app/settings"
        />
      </AppPage>
    );
  }

  return (
    <AppPage
      title="Competitor Intelligence"
      subtitle="Revenue at risk from competitor pressure — and how to recover it."
      primaryAction={<Button url="/app/faq" variant="primary">Generate Response Content</Button>}
      secondaryAction={<Button url="/app/settings">Configure tracking</Button>}
    >
      <BlockStack gap="500">
        {loadError ? <Banner tone="critical" title="Load error"><p>{loadError}</p></Banner> : null}
        {actionData && "error" in actionData ? (
          <Banner tone="critical" title="Action failed"><p>{actionData.error}</p></Banner>
        ) : null}
        {debugInfo ? (
          <Card>
            <Text as="p" variant="bodySm">{`Debug: ${debugInfo.count} competitor(s) detected in analysis`}</Text>
          </Card>
        ) : null}

        <div className="cia-metric-strip">
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Competitors Tracked</div>
            <Text as="p" variant="headingLg">{formatNumber(intelligence.length)}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Total Mentions</div>
            <Text as="p" variant="headingLg">{formatNumber(totalMentions)}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Revenue at Risk</div>
            <Text as="p" variant="headingLg">{`$${formatNumber(totalRevenue)}/mo`}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">High Switching Risk</div>
            <Text as="p" variant="headingLg">{formatNumber(totalSwitching)}</Text>
          </div>
        </div>

        {bars.length > 0 ? (
          <ChartCard title="Competitor pressure" subtitle="Mention volume per competitor brand">
            <BarChart data={bars} tone="info" limit={10} />
          </ChartCard>
        ) : null}

        <BlockStack gap="300">
          <SectionHeader
            title="Competitor Intelligence Cards"
            description="Revenue at risk, switching intent, price risk, and recovery opportunities per competitor."
          />
          <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
            {intelligence.map((item) => {
              const topIntents = Object.entries(item.intentBreakdown)
                .filter(([, c]) => c > 0)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 3);

              return (
                <Card key={item.name}>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="start" wrap={false} gap="200">
                      <BlockStack gap="050">
                        <Text as="h3" variant="headingMd">{item.name}</Text>
                        {item.topQuote ? (
                          <Text as="p" variant="bodySm" tone="subdued">
                            {`"${item.topQuote.slice(0, 80)}${item.topQuote.length > 80 ? "..." : ""}"`}
                          </Text>
                        ) : null}
                      </BlockStack>
                      <BlockStack gap="100">
                        {item.switchingRisk >= 50 ? <Badge tone="critical">High switching risk</Badge> : null}
                        {item.growthRate > 0 ? <Badge tone="warning">{`+${item.growthRate}% trend`}</Badge> : null}
                      </BlockStack>
                    </InlineStack>

                    <InlineGrid columns={{ xs: 2, sm: 4 }} gap="200">
                      <BlockStack gap="050">
                        <Text as="span" variant="bodySm" tone="subdued">Mentions</Text>
                        <Text as="span" variant="headingSm">{formatNumber(item.totalMentions)}</Text>
                      </BlockStack>
                      <BlockStack gap="050">
                        <Text as="span" variant="bodySm" tone="subdued">Revenue at risk</Text>
                        <Text as="span" variant="headingSm">{`$${formatNumber(item.revenueAtRisk)}/mo`}</Text>
                      </BlockStack>
                      <BlockStack gap="050">
                        <Text as="span" variant="bodySm" tone="subdued">Switching risk</Text>
                        <Text as="span" variant="headingSm">{`${item.switchingRisk}/100`}</Text>
                      </BlockStack>
                      <BlockStack gap="050">
                        <Text as="span" variant="bodySm" tone="subdued">Price risk</Text>
                        <Text as="span" variant="headingSm">{`${item.priceRisk}/100`}</Text>
                      </BlockStack>
                    </InlineGrid>

                    {topIntents.length > 0 ? (
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="span" variant="bodySm" tone="subdued">Intent:</Text>
                        {topIntents.map(([key]) => (
                          <Badge key={key} tone={INTENT_BADGE[key] ?? "info"}>
                            {INTENT_LABELS[key as keyof typeof INTENT_LABELS] ?? key}
                          </Badge>
                        ))}
                      </InlineStack>
                    ) : null}

                    <Divider />

                    <BlockStack gap="150">
                      <Text as="h4" variant="headingSm">Recovery opportunities</Text>
                      {item.opportunities.slice(0, 2).map((opp) => (
                        <BlockStack key={opp.type} gap="050">
                          <InlineStack align="space-between" blockAlign="center" wrap={false} gap="200">
                            <Text as="p" variant="bodyMd" fontWeight="semibold">{opp.label}</Text>
                            <Badge tone={opp.priority === "high" ? "critical" : opp.priority === "medium" ? "warning" : "info"}>
                              {opp.priority}
                            </Badge>
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">{opp.description}</Text>
                          <Text as="p" variant="bodySm">{`Est. recovery: $${formatNumber(opp.estimatedRevenue)}/mo`}</Text>
                        </BlockStack>
                      ))}
                    </BlockStack>

                    <Divider />

                    <InlineStack gap="200" wrap>
                      <Form method="post">
                        <input type="hidden" name="intent" value="generate-comparison" />
                        <input type="hidden" name="competitorName" value={item.name} />
                        <Button submit size="slim" variant="primary">
                          {aiEnabled ? "AI Comparison Content" : "Generate Comparison Content"}
                        </Button>
                      </Form>
                      <Form method="post">
                        <input type="hidden" name="intent" value="generate-why-us" />
                        <input type="hidden" name="competitorName" value={item.name} />
                        <Button submit size="slim">Why Buy From Us</Button>
                      </Form>
                      <Form method="post">
                        <input type="hidden" name="intent" value="publish-competitor-blog" />
                        <input type="hidden" name="competitorName" value={item.name} />
                        <Button submit size="slim">Publish Blog</Button>
                      </Form>
                    </InlineStack>
                  </BlockStack>
                </Card>
              );
            })}
          </InlineGrid>
        </BlockStack>

        {comparedProducts.length > 0 ? (
          <BlockStack gap="300">
            <SectionHeader
              title="Products Under Competitive Pressure"
              description="Products customers explicitly compare against alternatives."
            />
            <Card>
              <BlockStack gap="200">
                {comparedProducts.filter(Boolean).map((product, index) => (
                  <BlockStack key={`${product?.productId ?? product?.productTitle ?? index}`} gap="100">
                    {index > 0 ? <Divider /> : null}
                    <InlineStack align="space-between" blockAlign="center" wrap={false}>
                      <BlockStack gap="050">
                        <Text as="p" variant="bodyMd" fontWeight="semibold">{product?.productTitle ?? "Product"}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {`${formatNumber(product?.mentionCount ?? 0)} mentions · confusion score ${Math.round(product?.confusionScore ?? 0)}/100`}
                        </Text>
                      </BlockStack>
                      <Button url="/app/faq" size="slim">Generate Fix</Button>
                    </InlineStack>
                  </BlockStack>
                ))}
              </BlockStack>
            </Card>
          </BlockStack>
        ) : null}

        <div className="cia-three-grid">
          <KpiCard
            label="Highest switching risk"
            value={intelligence[0]?.name ?? "None"}
            detail={`${intelligence[0]?.switchingRisk ?? 0}/100 switching risk`}
            tone={intelligence[0]?.switchingRisk >= 50 ? "warning" : "info"}
          />
          <KpiCard
            label="Most revenue at risk"
            value={intelligence[0] ? `$${formatNumber(intelligence[0].revenueAtRisk)}/mo` : "$0/mo"}
            detail={`From ${intelligence[0]?.name ?? "competitors"}`}
            tone="warning"
          />
          <KpiCard
            label="Total recovery potential"
            value={`$${formatNumber(totalRevenue)}/mo`}
            detail="If all competitor objections are addressed"
            tone="success"
          />
        </div>
      </BlockStack>
    </AppPage>
  );
}
