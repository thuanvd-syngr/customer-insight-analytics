import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
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
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";
import { AppPage, EmptyStateCard, ListSkeleton, SectionHeader, formatNumber, moneyRange } from "~/components";
import { getDelegate } from "~/lib/prisma-safe";
import { generateFaqFromOpportunity, faqToHtml } from "~/lib/faq-generator";
import { logUsage } from "~/lib/log-usage.server";
import { EMPTY_INSIGHT } from "~/lib/types";
import type { KeywordGroupId } from "~/lib/types";
import { isReviewerMode, buildSampleInsight } from "~/lib/reviewer-mode.server";
import { ACTION_TIMEOUT_MS, formActionKey, makeActionKey, safeDecodeURIComponent, shopAdminProductUrl } from "~/lib/action-loading";

const SECTION_LABELS: Record<string, string> = {
  ingredients: "Ingredients",
  certifications: "Certifications",
  shipping: "Shipping info",
  return_policy: "Return policy",
  size_guide: "Size guide",
  warranty: "Warranty",
  usage: "Usage instructions",
  stock: "Stock / availability",
  compare: "Product comparison",
  payment: "Payment options",
};

async function getCtx(request: Request) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  return { shop, session };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const productId = params.id ?? "";
  const decodedId = safeDecodeURIComponent(productId);
  try {
    const { shop } = await getCtx(request);

    const sampleMode = await isReviewerMode(prisma, shop.id);
    const latestRun = await getLatestRun(prisma, shop.id);
    const insight = sampleMode
      ? buildSampleInsight()
      : (parseRun(latestRun) ?? EMPTY_INSIGHT);

    const productDelegate = getDelegate(prisma, "shopifyProduct");
    const productRow = productDelegate?.findFirst
      ? await productDelegate.findFirst({
          where: { shopId: shop.id, externalId: decodedId },
        })
      : null;

    const product = productRow as {
      id?: string;
      title?: string;
      vendor?: string;
      productType?: string;
      handle?: string;
      description?: string;
    } | null;

    const productTitle =
      product?.title ??
      insight.productConfusion.find(
        (p) => p.productId === decodedId,
      )?.productTitle ??
      insight.contentGaps.find(
        (g) => g.productId === decodedId,
      )?.productTitle ??
      `Product ${productId}`;

    const confusion = insight.productConfusion.find(
      (p) =>
        p.productId === decodedId ||
        p.productTitle.toLowerCase() === productTitle.toLowerCase(),
    );

    const gap = insight.contentGaps.find(
      (g) =>
        g.productId === decodedId ||
        g.productTitle.toLowerCase() === productTitle.toLowerCase(),
    );

    const topGroups: KeywordGroupId[] = (
      confusion?.topGroups ??
      gap?.missingSections.slice(0, 4) ??
      []
    ).slice(0, 4) as KeywordGroupId[];

    const relatedOpportunities = insight.questionOpportunities.filter((o) =>
      topGroups.includes(o.groupId),
    );

    const draftDelegate = getDelegate(prisma, "productOptimizationDraft");
    const existingDrafts = draftDelegate?.findMany
      ? await draftDelegate.findMany({
          where: { shopId: shop.id, productId },
          orderBy: { createdAt: "desc" },
          take: 5,
        })
      : [];

    return json({
      productId,
      decodedProductId: decodedId,
      productTitle,
      vendor: product?.vendor ?? null,
      productType: product?.productType ?? null,
      handle: product?.handle ?? null,
      confusion,
      gap,
      topGroups,
      relatedOpportunities,
      existingDrafts,
      isSampleMode: sampleMode,
      shopDomain: shop.shopDomain,
      adminProductUrl: shopAdminProductUrl(shop.shopDomain, decodedId),
      loadError: null,
    });
  } catch (error) {
    console.error("Product recovery loader failed", error);
    return json({
      productId,
      decodedProductId: decodedId,
      productTitle: `Product ${productId}`,
      vendor: null,
      productType: null,
      handle: null,
      confusion: null,
      gap: null,
      topGroups: [] as KeywordGroupId[],
      relatedOpportunities: [],
      existingDrafts: [],
      isSampleMode: false,
      shopDomain: "",
      adminProductUrl: null,
      loadError: "Recovery data is loading. Refresh in a moment.",
    });
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const productId = params.id ?? "";
  try {
    const { shop } = await getCtx(request);
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "");
    const productTitle = String(form.get("productTitle") ?? "Product");

    if (intent === "generate-pack") {
      const rawGroups = String(form.get("topGroups") ?? "");
      const groups = rawGroups
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean)
        .slice(0, 4) as KeywordGroupId[];

      if (groups.length === 0) {
        return json({ success: false, count: 0, error: "No recovery topics found for this product." });
      }

      let created = 0;
      for (const groupId of groups) {
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
          suggestedAction: `Create a FAQ answering ${groupId} questions for ${productTitle}.`,
        });

        await prisma.generatedFaq.create({
          data: {
            shopId: shop.id,
            groupId,
            productId: safeDecodeURIComponent(productId),
            productTitle,
            question: faq.question,
            answerText: faq.answer,
            answerHtml: faqToHtml(faq),
            format: "seo",
            source: "rule",
            status: "draft",
            publishTarget: "metafield",
          },
        });
        created++;
      }

      await logUsage(prisma, shop.id, "recovery_pack_generated", {
        productId,
        productTitle,
        faqCount: created,
      });

      return json({ success: true, count: created, error: null });
    }

    return json({ success: false, count: 0, error: "Unknown intent." });
  } catch (error) {
    console.error("Product recovery action failed", error);
    return json({
      success: false,
      count: 0,
      error: "Could not generate recovery pack. Try again.",
    });
  }
}

export default function ProductRecoveryPage() {
  const {
    productId,
    decodedProductId,
    productTitle,
    vendor,
    productType,
    handle,
    confusion,
    gap,
    topGroups,
    relatedOpportunities,
    existingDrafts,
    isSampleMode,
    adminProductUrl,
    loadError,
  } = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);
  const [pendingStartedAt, setPendingStartedAt] = useState<number | null>(null);
  const [timeoutWarning, setTimeoutWarning] = useState(false);
  const generateKey = makeActionKey("generate:recovery-pack", decodedProductId);
  const activeFormKey = formActionKey(navigation.formData);
  const generateLoading = navigation.state !== "idle" && (activeFormKey === generateKey || pendingActionKey === generateKey);

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

  const revenueAtRisk =
    gap?.estimatedHigh ??
    relatedOpportunities.reduce((s, o) => s + (o?.highEstimate ?? 0), 0);

  const revenueAtRiskLow =
    gap?.estimatedLow ??
    relatedOpportunities.reduce((s, o) => s + (o?.lowEstimate ?? 0), 0);

  const questionCount = confusion?.mentionCount ?? gap?.mentionCount ?? 0;
  const confusionScore = confusion?.confusionScore ?? gap?.contentGapScore ?? 0;

  const hasData = Boolean(confusion || gap);

  if (!hasData) {
    return (
      <AppPage
        title={productTitle}
        subtitle="No recovery data found for this product yet."
        primaryAction={<Button url="/app/import" variant="primary">Run Analysis</Button>}
        secondaryAction={<Button url="/app/products">Back to Products</Button>}
      >
        {loadError ? (
          <Banner tone="info" title="Data loading">
            <p>{loadError}</p>
          </Banner>
        ) : null}
        <EmptyStateCard
          title="No product-specific recovery gaps yet"
          body="This product has not been linked to customer questions yet. Import customer questions and run analysis to find recovery opportunities."
          actionLabel="Import Customer Questions"
          actionUrl="/app/import"
        />
      </AppPage>
    );
  }

  return (
    <AppPage
      title={productTitle}
      subtitle={
        revenueAtRisk > 0
          ? `${moneyRange(revenueAtRiskLow, revenueAtRisk)}/mo at risk — answer these questions to recover revenue.`
          : "Customer questions signal buying friction on this product."
      }
      primaryAction={
        <Form method="post">
          <input type="hidden" name="intent" value="generate-pack" />
          <input type="hidden" name="actionKey" value={generateKey} />
          <input type="hidden" name="productTitle" value={productTitle} />
          <input type="hidden" name="topGroups" value={topGroups.join(",")} />
          <Button
            submit
            variant="primary"
            loading={generateLoading}
            disabled={generateLoading}
            onClick={() => {
              setPendingActionKey(generateKey);
              setPendingStartedAt(Date.now());
              setTimeoutWarning(false);
            }}
          >
            Generate Recovery Pack
          </Button>
        </Form>
      }
      secondaryAction={adminProductUrl ? <Button url={adminProductUrl} target="_blank">View in Shopify Admin</Button> : <Button url="/app/products">Back to Products</Button>}
    >
      <BlockStack gap="500">
        {loadError ? (
          <Banner tone="info" title="Data loading"><p>{loadError}</p></Banner>
        ) : null}

        {isSampleMode ? (
          <Banner tone="info" title="Sample data — showing demo recovery plan">
            <p>
              This is an example recovery plan. Import your customer questions to see
              real recovery opportunities for your products.
            </p>
            <Button url="/app/import" variant="plain">Import Customer Questions</Button>
          </Banner>
        ) : null}

        {timeoutWarning ? (
          <Banner tone="warning" title="Action took longer than expected">
            <p>Action took longer than expected. You can safely retry.</p>
          </Banner>
        ) : null}

        {actionData?.success ? (
          <Banner tone="success" title={`Recovery pack created — ${actionData.count} FAQ drafts ready`}>
            <p>FAQ drafts are saved and ready to review in the FAQ Builder.</p>
            <Button url="/app/faq" variant="plain">Open FAQ Builder</Button>
          </Banner>
        ) : actionData?.error ? (
          <Banner tone="warning" title="Could not generate pack">
            <p>{actionData.error}</p>
          </Banner>
        ) : null}

        {/* Product metadata */}
        <div className="cia-metric-strip">
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Revenue at Risk</div>
            <Text as="p" variant="headingLg">
              {revenueAtRisk > 0 ? `${moneyRange(revenueAtRiskLow, revenueAtRisk)}/mo` : "Run analysis"}
            </Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Customer Questions</div>
            <Text as="p" variant="headingLg">{formatNumber(questionCount)}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Confusion Score</div>
            <Text as="p" variant="headingLg">{confusionScore}/100</Text>
          </div>
          {vendor ? (
            <div className="cia-muted-panel">
              <div className="cia-eyebrow">Vendor</div>
              <Text as="p" variant="headingMd">{vendor}</Text>
            </div>
          ) : null}
          {handle ? (
            <div className="cia-muted-panel">
              <div className="cia-eyebrow">Handle</div>
              <Text as="p" variant="bodySm" tone="subdued">{handle}</Text>
            </div>
          ) : null}
        </div>

        {/* Missing content sections */}
        {gap && gap.missingSections.length > 0 ? (
          <Card>
            <BlockStack gap="300">
              <SectionHeader
                title="Missing Content Sections"
                description="These sections are absent from the product page but customers are asking about them."
              />
              <InlineStack gap="200" wrap>
                {gap.missingSections.map((section) => (
                  <Badge key={section} tone="warning">
                    {SECTION_LABELS[section] ?? section.replace(/_/g, " ")}
                  </Badge>
                ))}
              </InlineStack>
              {gap.coveredSections.length > 0 ? (
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">Already covered:</Text>
                  <InlineStack gap="200" wrap>
                    {gap.coveredSections.map((section) => (
                      <Badge key={section} tone="success">
                        {SECTION_LABELS[section] ?? section.replace(/_/g, " ")}
                      </Badge>
                    ))}
                  </InlineStack>
                </BlockStack>
              ) : null}
            </BlockStack>
          </Card>
        ) : null}

        {/* Customer questions */}
        {gap?.customerQuestions && gap.customerQuestions.length > 0 ? (
          <Card>
            <BlockStack gap="200">
              <SectionHeader
                title="Questions Customers Are Asking"
                description="Real buying questions that indicate missing product information."
              />
              {gap.customerQuestions.slice(0, 6).map((q, idx) => (
                <BlockStack key={idx} gap="050">
                  {idx > 0 ? <Divider /> : null}
                  <InlineStack gap="200" blockAlign="center">
                    <Badge tone="info">{`${idx + 1}`}</Badge>
                    <Text as="p" variant="bodyMd">{q}</Text>
                  </InlineStack>
                </BlockStack>
              ))}
            </BlockStack>
          </Card>
        ) : confusion?.exampleQuote ? (
          <Card>
            <BlockStack gap="200">
              <SectionHeader
                title="Example Customer Question"
                description="A representative question from customers about this product."
              />
              <Text as="p" variant="bodyMd" tone="subdued">"{confusion.exampleQuote}"</Text>
            </BlockStack>
          </Card>
        ) : null}

        {/* Related storewide opportunities */}
        {relatedOpportunities.length > 0 ? (
          <Card>
            <BlockStack gap="300">
              <SectionHeader
                title="Recovery Opportunities"
                description="Storewide topics that also affect this product — ranked by revenue impact."
              />
              {relatedOpportunities.filter(Boolean).map((opp, idx) => (
                <BlockStack key={opp?.groupId ?? idx} gap="100">
                  {idx > 0 ? <Divider /> : null}
                  <InlineStack align="space-between" blockAlign="center" wrap={false} gap="300">
                    <BlockStack gap="050">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="p" variant="bodyMd" fontWeight="semibold">{opp?.label}</Text>
                        <Badge tone={opp?.severity === "high" ? "warning" : "info"}>
                          {opp?.severity}
                        </Badge>
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">{opp?.suggestedAction}</Text>
                    </BlockStack>
                    <BlockStack gap="050">
                      <Text as="p" variant="bodyMd" tone="success">
                        {(opp?.highEstimate ?? 0) > 0
                          ? `${moneyRange(opp?.lowEstimate ?? 0, opp?.highEstimate ?? 0)}/mo`
                          : "Add orders for estimate"}
                      </Text>
                      <Button url={`/app/faq?groupId=${opp?.groupId}`} size="slim">
                        Create Answer
                      </Button>
                    </BlockStack>
                  </InlineStack>
                </BlockStack>
              ))}
            </BlockStack>
          </Card>
        ) : null}

        {/* Recommended actions */}
        {gap?.recommendedActions && gap.recommendedActions.length > 0 ? (
          <Card>
            <BlockStack gap="300">
              <SectionHeader
                title="Recommended Actions"
                description="Priority fixes to close the content gap and recover revenue."
              />
              <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                {gap.recommendedActions.map((action, idx) => (
                  <Card key={idx}>
                    <BlockStack gap="150">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{action}</Text>
                      <InlineStack gap="200">
                        <Button url={`/app/products/${encodeURIComponent(productId)}/optimize`} size="slim">
                          Generate Content
                        </Button>
                        <Button url="/app/faq" size="slim">
                          Create FAQ
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                ))}
              </InlineGrid>
            </BlockStack>
          </Card>
        ) : null}

        {/* Existing drafts */}
        {existingDrafts.length > 0 ? (
          <Card>
            <BlockStack gap="200">
              <SectionHeader
                title="Existing Recovery Drafts"
                description="Content already drafted for this product."
              />
              {(existingDrafts as Array<{ id: string; sectionType?: string; status?: string; createdAt?: string }>).map(
                (draft, idx) => (
                  <BlockStack key={draft.id} gap="050">
                    {idx > 0 ? <Divider /> : null}
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="200" blockAlign="center">
                        <Badge tone={draft.status === "published" ? "success" : "info"}>
                          {draft.status ?? "draft"}
                        </Badge>
                        <Text as="p" variant="bodySm">
                          {draft.sectionType
                            ? SECTION_LABELS[draft.sectionType] ?? draft.sectionType
                            : "Content draft"}
                        </Text>
                      </InlineStack>
                      <Button
                        url={`/app/products/${encodeURIComponent(productId)}/optimize`}
                        size="slim"
                      >
                        View Draft
                      </Button>
                    </InlineStack>
                  </BlockStack>
                ),
              )}
            </BlockStack>
          </Card>
        ) : null}

        {/* Quick action strip */}
        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
          <Card>
            <BlockStack gap="150">
              <Text as="h3" variant="headingSm">Generate Product Answer</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Create targeted FAQ content for this product's top questions.
              </Text>
              <Button url={`/app/products/${encodeURIComponent(productId)}/optimize`} size="slim">
                Open Product Optimizer
              </Button>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="150">
              <Text as="h3" variant="headingSm">Publish FAQ to Store</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Push a product FAQ page live to Shopify when drafts are ready.
              </Text>
              <Button url="/app/publish" size="slim">Go to Publish</Button>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="150">
              <Text as="h3" variant="headingSm">View All Opportunities</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                See the full storewide list of questions blocking sales.
              </Text>
              <Button url="/app/insights" size="slim">View Opportunities</Button>
            </BlockStack>
          </Card>
        </InlineGrid>
      </BlockStack>
    </AppPage>
  );
}
