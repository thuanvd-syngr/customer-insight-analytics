import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation, useParams } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Divider,
  InlineStack,
  Select,
  Text,
} from "@shopify/polaris";
import { useState } from "react";

import prisma from "~/db.server";
import { ensureShop } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";
import { AppPage, ListSkeleton, SectionHeader, formatNumber } from "~/components";
import { getDelegate } from "~/lib/prisma-safe";
import {
  buildRuleBasedProductSection,
  SECTION_TYPE_LABELS,
  PRODUCT_SECTION_TYPES,
  type ProductSectionType,
  type ProductOptimizationResult,
} from "~/lib/product-optimizer";
import { PLAN_EXTENDED_LIMITS } from "~/lib/billing/plan-limits";
import type { PlanId } from "~/lib/billing";

async function getCtx(request: Request) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  return { shop, session };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const productId = params.id ?? "";
  try {
    const { shop } = await getCtx(request);
    const planLimits = PLAN_EXTENDED_LIMITS[shop.plan as PlanId];

    // Fetch product from our local snapshot
    const productDelegate = getDelegate(prisma, "shopifyProduct");
    const product = productDelegate?.findFirst
      ? await productDelegate.findFirst({
          where: { shopId: shop.id, externalId: decodeURIComponent(productId) },
        })
      : null;

    const productTitle = (product as { title?: string } | null)?.title ?? `Product ${productId}`;
    const productDescription = (product as { description?: string } | null)?.description ?? "";

    // Fetch existing drafts for this product
    const draftDelegate = getDelegate(prisma, "productOptimizationDraft");
    const existingDrafts = draftDelegate?.findMany
      ? await draftDelegate.findMany({
          where: { shopId: shop.id, productId },
          orderBy: { createdAt: "desc" },
        })
      : [];

    return json({
      productId,
      productTitle,
      productDescription,
      existingDrafts,
      canOptimize: planLimits.aiProductOptimize,
      plan: shop.plan,
      loadError: null,
    });
  } catch (error) {
    console.error("Optimize loader failed", error);
    return json({
      productId,
      productTitle: `Product ${productId}`,
      productDescription: "",
      existingDrafts: [],
      canOptimize: false,
      plan: "free",
      loadError: "Could not load product. Try refreshing.",
    });
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const productId = params.id ?? "";
  try {
    const { shop, session } = await getCtx(request);
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "");
    const sectionType = String(form.get("sectionType") ?? "description") as ProductSectionType;
    const productTitle = String(form.get("productTitle") ?? "Product");
    const storeName = session.shop.replace(".myshopify.com", "");
    const draftDelegate = getDelegate(prisma, "productOptimizationDraft");

    if (intent === "generate-section") {
      const result: ProductOptimizationResult = buildRuleBasedProductSection({
        productId,
        productTitle,
        sectionType,
        storeName,
        shopDomain: session.shop,
      });

      if (draftDelegate?.create) {
        await draftDelegate.create({
          data: {
            shopId: shop.id,
            productId,
            productTitle,
            sectionType,
            originalContent: String(form.get("originalContent") ?? ""),
            draftContent: result.draftContent,
            draftHtml: result.draftHtml,
            source: result.source,
            status: "draft",
          },
        });
      }
      return json({ success: true, generated: result });
    }

    if (intent === "publish-section") {
      const draftId = String(form.get("draftId") ?? "");
      const draftContent = String(form.get("draftContent") ?? "");

      // Publish to Shopify product metafield
      const { admin } = await authenticate.admin(request);
      const gid = decodeURIComponent(productId);
      const metafieldKey = `section_${sectionType}`;

      try {
        await admin.graphql(
          `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields { id key namespace }
              userErrors { field message }
            }
          }`,
          {
            variables: {
              metafields: [{
                ownerId: gid.startsWith("gid://") ? gid : `gid://shopify/Product/${gid}`,
                namespace: "customer_insight",
                key: metafieldKey,
                value: draftContent,
                type: "multi_line_text_field",
              }],
            },
          },
        );
      } catch (err) {
        console.error("Metafield publish failed", err);
      }

      if (draftDelegate?.update && draftId) {
        await draftDelegate.update({
          where: { id: draftId },
          data: { status: "published", publishedAt: new Date() },
        });
      }
      return redirect(`/app/products/${params.id}/optimize`);
    }

    if (intent === "rollback-section") {
      const draftId = String(form.get("draftId") ?? "");
      if (draftDelegate?.update && draftId) {
        await draftDelegate.update({
          where: { id: draftId },
          data: { status: "rolled_back", rolledBackAt: new Date() },
        });
      }
      return redirect(`/app/products/${params.id}/optimize`);
    }

    if (intent === "delete-draft") {
      const draftId = String(form.get("draftId") ?? "");
      const deleteDelegate = getDelegate(prisma, "productOptimizationDraft") as
        | { delete?: (args: unknown) => Promise<unknown> }
        | null;
      if (deleteDelegate?.delete && draftId) {
        await deleteDelegate.delete({ where: { id: draftId } });
      }
      return redirect(`/app/products/${params.id}/optimize`);
    }

    return redirect(`/app/products/${params.id}/optimize`);
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Optimize action failed", error);
    return json({ error: error instanceof Error ? error.message : "Action failed." }, { status: 500 });
  }
}

const STATUS_TONE: Record<string, "success" | "warning" | "info" | "critical"> = {
  published: "success",
  rolled_back: "warning",
  draft: "info",
};

export default function ProductOptimizePage() {
  const { productId, productTitle, productDescription, existingDrafts, canOptimize, loadError } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const params = useParams();
  const [sectionType, setSectionType] = useState<string>("description");

  if (navigation.state === "loading") return <ListSkeleton />;

  const isGenerating = navigation.state === "submitting";
  const sectionOptions = PRODUCT_SECTION_TYPES.map((t) => ({ value: t, label: SECTION_TYPE_LABELS[t] }));

  const latestGenerated =
    actionData && "generated" in actionData ? (actionData.generated as ProductOptimizationResult) : null;

  return (
    <AppPage
      title={`Optimize: ${productTitle}`}
      subtitle="Generate AI or rule-based content for each product section. Preview, save draft, then publish."
      primaryAction={<Button url={`/app/products/${params.id}`}>Back to product</Button>}
      secondaryAction={<Button url="/app/products">All products</Button>}
    >
      <BlockStack gap="500">
        {loadError ? <Banner tone="critical" title="Load error"><p>{loadError}</p></Banner> : null}
        {actionData && "error" in actionData ? (
          <Banner tone="critical" title="Action failed"><p>{actionData.error}</p></Banner>
        ) : null}

        {!canOptimize ? (
          <Banner tone="warning" title="Growth or Pro plan required">
            <p>AI product optimization is available on Growth ($49/mo) and above. Rule-based generation is available on all plans.</p>
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="300">
            <SectionHeader
              title="Generate Section"
              description="Pick a section type and generate optimized content. Content is saved as a draft until you publish."
            />
            <Form method="post">
              <input type="hidden" name="intent" value="generate-section" />
              <input type="hidden" name="productTitle" value={productTitle} />
              <input type="hidden" name="originalContent" value={productDescription.slice(0, 500)} />
              <BlockStack gap="300">
                <Select
                  label="Section to optimize"
                  options={sectionOptions}
                  value={sectionType}
                  onChange={setSectionType}
                />
                <input type="hidden" name="sectionType" value={sectionType} />
                <Button submit variant="primary" loading={isGenerating}>
                  {isGenerating ? "Generating…" : "Generate Draft"}
                </Button>
              </BlockStack>
            </Form>
          </BlockStack>
        </Card>

        {latestGenerated ? (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingMd">
                  {SECTION_TYPE_LABELS[latestGenerated.sectionType]} — Draft Preview
                </Text>
                <InlineStack gap="200">
                  <Badge tone={latestGenerated.source === "ai" ? "success" : "info"}>
                    {latestGenerated.source === "ai" ? "AI" : "Rule-based"}
                  </Badge>
                  <Badge tone="info">{`${formatNumber(latestGenerated.characterCount)} chars`}</Badge>
                </InlineStack>
              </InlineStack>
              <Divider />
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">Generated content (plain text):</Text>
                <div
                  style={{
                    background: "#f9fafb",
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    padding: "12px 16px",
                    fontFamily: "inherit",
                    fontSize: 14,
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {latestGenerated.draftContent}
                </div>
              </BlockStack>
            </BlockStack>
          </Card>
        ) : null}

        {existingDrafts.length > 0 ? (
          <BlockStack gap="300">
            <SectionHeader
              title="Saved Drafts"
              description="Generated sections for this product. Publish to push to Shopify, or rollback to restore original."
            />
            <BlockStack gap="300">
              {(existingDrafts as Array<{
                id: string;
                sectionType: string;
                source: string;
                status: string;
                draftContent: string;
                originalContent?: string | null;
                createdAt: string;
                publishedAt?: string | null;
              }>).map((draft) => (
                <Card key={draft.id}>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center" wrap={false}>
                      <BlockStack gap="050">
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="h4" variant="headingSm">
                            {SECTION_TYPE_LABELS[draft.sectionType as ProductSectionType] ?? draft.sectionType}
                          </Text>
                          <Badge tone={STATUS_TONE[draft.status] ?? "info"}>{draft.status}</Badge>
                          <Badge tone={draft.source === "ai" ? "success" : "info"}>{draft.source}</Badge>
                        </InlineStack>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {`Created ${new Date(draft.createdAt).toLocaleDateString()}`}
                          {draft.publishedAt ? ` · Published ${new Date(draft.publishedAt).toLocaleDateString()}` : ""}
                        </Text>
                      </BlockStack>
                    </InlineStack>

                    {draft.originalContent ? (
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">Original:</Text>
                        <div
                          style={{
                            background: "#fff8ed",
                            border: "1px solid #fde68a",
                            borderRadius: 6,
                            padding: "8px 12px",
                            fontSize: 13,
                            whiteSpace: "pre-wrap",
                            maxHeight: 80,
                            overflow: "hidden",
                          }}
                        >
                          {draft.originalContent}
                        </div>
                      </BlockStack>
                    ) : null}

                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">Draft:</Text>
                      <div
                        style={{
                          background: "#f0fdf4",
                          border: "1px solid #86efac",
                          borderRadius: 6,
                          padding: "8px 12px",
                          fontSize: 13,
                          whiteSpace: "pre-wrap",
                          maxHeight: 120,
                          overflow: "auto",
                        }}
                      >
                        {draft.draftContent}
                      </div>
                    </BlockStack>

                    {draft.status === "draft" ? (
                      <InlineStack gap="200" wrap>
                        <Form method="post">
                          <input type="hidden" name="intent" value="publish-section" />
                          <input type="hidden" name="draftId" value={draft.id} />
                          <input type="hidden" name="draftContent" value={draft.draftContent} />
                          <input type="hidden" name="sectionType" value={draft.sectionType} />
                          <input type="hidden" name="productTitle" value={productTitle} />
                          <Button submit variant="primary" size="slim">Publish to Shopify</Button>
                        </Form>
                        <Form method="post">
                          <input type="hidden" name="intent" value="delete-draft" />
                          <input type="hidden" name="draftId" value={draft.id} />
                          <Button submit size="slim" tone="critical">Delete Draft</Button>
                        </Form>
                      </InlineStack>
                    ) : null}

                    {draft.status === "published" ? (
                      <Form method="post">
                        <input type="hidden" name="intent" value="rollback-section" />
                        <input type="hidden" name="draftId" value={draft.id} />
                        <Button submit size="slim" tone="critical">Rollback</Button>
                      </Form>
                    ) : null}
                  </BlockStack>
                </Card>
              ))}
            </BlockStack>
          </BlockStack>
        ) : null}
      </BlockStack>
    </AppPage>
  );
}
