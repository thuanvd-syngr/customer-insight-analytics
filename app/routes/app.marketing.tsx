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
  Select,
  Text,
} from "@shopify/polaris";
import { useState } from "react";

import prisma from "~/db.server";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { EMPTY_INSIGHT } from "~/lib/types";
import { authenticate } from "~/shopify.server";
import { AppPage, EmptyStateCard, ListSkeleton, SectionHeader, formatNumber } from "~/components";
import { getDelegate } from "~/lib/prisma-safe";
import {
  generateMarketingAsset,
  generateAssetBatch,
  ASSET_TYPE_LABELS,
  PLATFORM_LABELS,
  TONE_LABELS,
  type MarketingAssetType,
  type MarketingPlatform,
  type MarketingTone,
} from "~/lib/marketing-assets";
import { canUseAIProductOptimize } from "~/lib/billing/plan-limits";
import type { PlanId } from "~/lib/billing";

async function getCtx(request: Request) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  return { shop, session };
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { shop, session } = await getCtx(request);
    const insight = parseRun(await getLatestRun(prisma, shop.id)) ?? EMPTY_INSIGHT;
    const gate = canUseAIProductOptimize(shop.plan as PlanId);

    const marketingAsset = getDelegate(prisma, "marketingAsset");
    const recentAssets = marketingAsset?.findMany
      ? await marketingAsset.findMany({
          where: { shopId: shop.id },
          orderBy: { createdAt: "desc" },
          take: 30,
        })
      : [];

    return json({
      insight,
      recentAssets,
      storeName: session.shop.replace(".myshopify.com", ""),
      canGenerate: gate.allowed,
      gateReason: gate.reason ?? null,
      loadError: null,
    });
  } catch (error) {
    console.error("Marketing loader failed", error);
    return json({
      insight: EMPTY_INSIGHT,
      recentAssets: [],
      storeName: "your-store",
      canGenerate: false,
      gateReason: "Could not load marketing data.",
      loadError: "Could not load marketing assets. Try refreshing.",
    });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { shop, session } = await getCtx(request);
    const form = await request.formData();
    const intent = String(form.get("intent") ?? "");
    const assetType = String(form.get("assetType") ?? "social_post") as MarketingAssetType;
    const platform = String(form.get("platform") ?? "generic") as MarketingPlatform;
    const tone = String(form.get("tone") ?? "professional") as MarketingTone;
    const groupId = form.get("groupId") ? String(form.get("groupId")) : undefined;

    if (intent === "generate") {
      const insight = parseRun(await getLatestRun(prisma, shop.id)) ?? EMPTY_INSIGHT;
      const storeName = session.shop.replace(".myshopify.com", "");

      const generated = generateMarketingAsset({
        assetType,
        platform,
        tone,
        storeName,
        groupId,
        insight,
      });

      // Persist to DB
      const marketingAsset = getDelegate(prisma, "marketingAsset");
      if (marketingAsset?.create) {
        await marketingAsset.create({
          data: {
            shopId: shop.id,
            assetType: generated.assetType,
            platform: generated.platform,
            content: generated.content,
            headline: generated.headline ?? null,
            cta: generated.cta ?? null,
            groupId: groupId ?? null,
            tone: generated.tone,
            status: "draft",
          },
        });
      }

      return json({ error: null, generated });
    }

    if (intent === "generate-batch") {
      const insight = parseRun(await getLatestRun(prisma, shop.id)) ?? EMPTY_INSIGHT;
      const storeName = session.shop.replace(".myshopify.com", "");
      const allTypes: MarketingAssetType[] = ["social_post", "email_subject", "ad_copy", "review_request", "sms_snippet"];

      const batch = generateAssetBatch({ platform, tone, storeName, groupId, insight }, allTypes);

      const marketingAsset = getDelegate(prisma, "marketingAsset");
      if (marketingAsset?.create) {
        for (const asset of batch) {
          await marketingAsset.create({
            data: {
              shopId: shop.id,
              assetType: asset.assetType,
              platform: asset.platform,
              content: asset.content,
              headline: asset.headline ?? null,
              cta: asset.cta ?? null,
              groupId: groupId ?? null,
              tone: asset.tone,
              status: "draft",
            },
          });
        }
      }

      return redirect("/app/marketing");
    }

    return redirect("/app/marketing");
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Marketing action failed", error);
    return json({ error: "Generation failed.", generated: null }, { status: 500 });
  }
}

const ASSET_OPTIONS = Object.entries(ASSET_TYPE_LABELS).map(([value, label]) => ({ value, label }));
const PLATFORM_OPTIONS = Object.entries(PLATFORM_LABELS).map(([value, label]) => ({ value, label }));
const TONE_OPTIONS = Object.entries(TONE_LABELS).map(([value, label]) => ({ value, label }));

const STATUS_TONE: Record<string, "success" | "info" | "warning"> = {
  draft: "info",
  used: "success",
  archived: "warning",
};

export default function MarketingPage() {
  const { insight, recentAssets, storeName, canGenerate, gateReason, loadError } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [assetType, setAssetType] = useState<string>("social_post");
  const [platform, setPlatform] = useState<string>("instagram");
  const [tone, setTone] = useState<string>("friendly");
  const [groupId, setGroupId] = useState<string>("");

  if (navigation.state === "loading") return <ListSkeleton />;
  const isGenerating = navigation.state === "submitting";
  const generated = actionData && "generated" in actionData ? actionData.generated : null;

  const groupOptions = [
    { value: "", label: "No specific group" },
    ...["shipping", "return", "warranty", "payment", "discount", "competitor"].map((g) => ({
      value: g,
      label: g.charAt(0).toUpperCase() + g.slice(1),
    })),
  ];

  return (
    <AppPage
      title="Marketing Assets Generator"
      subtitle="Generate on-brand social posts, email subjects, ad copy, review requests, and SMS snippets from your store data."
      primaryAction={<Button url="/app/insights">View Insights</Button>}
    >
      <BlockStack gap="500">
        {loadError ? <Banner tone="critical" title="Load error"><p>{loadError}</p></Banner> : null}
        {actionData && "error" in actionData && actionData.error ? (
          <Banner tone="critical" title="Error"><p>{actionData.error}</p></Banner>
        ) : null}

        {!canGenerate ? (
          <Banner tone="warning" title="Growth or Pro plan required">
            <p>{gateReason} <a href="/app/billing">Upgrade →</a></p>
          </Banner>
        ) : null}

        <div className="cia-metric-strip">
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Assets Generated</div>
            <Text as="p" variant="headingLg">{formatNumber(recentAssets.length)}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Insight Score</div>
            <Text as="p" variant="headingLg">{insight.insightScore}/100</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Top Opportunity</div>
            <Text as="p" variant="bodyMd">
              {insight.storewideOpportunities[0]?.label ?? "None yet"}
            </Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Store</div>
            <Text as="p" variant="bodyMd">{storeName}</Text>
          </div>
        </div>

        {/* Generator form */}
        <Card>
          <BlockStack gap="400">
            <SectionHeader
              title="Generate Asset"
              description="Configure the type, platform, and tone, then generate one asset or a full batch."
            />
            <Form method="post">
              <input type="hidden" name="intent" value="generate" />
              <BlockStack gap="300">
                <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                  <Select
                    label="Asset type"
                    options={ASSET_OPTIONS}
                    value={assetType}
                    onChange={setAssetType}
                    disabled={!canGenerate}
                  />
                  <input type="hidden" name="assetType" value={assetType} />
                  <Select
                    label="Platform"
                    options={PLATFORM_OPTIONS}
                    value={platform}
                    onChange={setPlatform}
                    disabled={!canGenerate}
                  />
                  <input type="hidden" name="platform" value={platform} />
                  <Select
                    label="Tone"
                    options={TONE_OPTIONS}
                    value={tone}
                    onChange={setTone}
                    disabled={!canGenerate}
                  />
                  <input type="hidden" name="tone" value={tone} />
                  <Select
                    label="Topic group (optional)"
                    options={groupOptions}
                    value={groupId}
                    onChange={setGroupId}
                    disabled={!canGenerate}
                  />
                  <input type="hidden" name="groupId" value={groupId} />
                </InlineGrid>
                <InlineStack gap="300">
                  <Button
                    submit
                    variant="primary"
                    loading={isGenerating}
                    disabled={!canGenerate}
                  >
                    {isGenerating ? "Generating…" : "Generate Asset"}
                  </Button>
                  <Form method="post" style={{ display: "inline" }}>
                    <input type="hidden" name="intent" value="generate-batch" />
                    <input type="hidden" name="platform" value={platform} />
                    <input type="hidden" name="tone" value={tone} />
                    <input type="hidden" name="groupId" value={groupId} />
                    <Button submit loading={isGenerating} disabled={!canGenerate}>
                      Generate Full Batch (All Types)
                    </Button>
                  </Form>
                </InlineStack>
              </BlockStack>
            </Form>
          </BlockStack>
        </Card>

        {/* Preview generated asset */}
        {generated ? (
          <Card>
            <BlockStack gap="300">
              <SectionHeader
                title="Generated Asset"
                description={`${ASSET_TYPE_LABELS[generated.assetType as MarketingAssetType]} for ${PLATFORM_LABELS[generated.platform as MarketingPlatform]}`}
              />
              <InlineStack gap="200" wrap>
                <Badge tone="info">{ASSET_TYPE_LABELS[generated.assetType as MarketingAssetType]}</Badge>
                <Badge tone="info">{PLATFORM_LABELS[generated.platform as MarketingPlatform]}</Badge>
                <Badge tone={generated.isWithinLimit ? "success" : "warning"}>
                  {`${generated.charCount} chars ${generated.isWithinLimit ? "✓" : "⚠ limit exceeded"}`}
                </Badge>
              </InlineStack>
              {generated.headline ? (
                <Text as="p" variant="bodyMd" fontWeight="semibold">{generated.headline}</Text>
              ) : null}
              <div style={{ background: "var(--p-color-bg-surface-secondary)", borderRadius: "8px", padding: "12px" }}>
                <Text as="p" variant="bodyMd">{generated.content}</Text>
              </div>
              {generated.cta ? (
                <Text as="p" variant="bodySm" tone="subdued">CTA: {generated.cta}</Text>
              ) : null}
            </BlockStack>
          </Card>
        ) : null}

        {/* Recent assets */}
        {recentAssets.length === 0 ? (
          <EmptyStateCard
            title="No marketing assets yet"
            body="Generate your first marketing asset above using your store's insight data."
            actionLabel="Generate Now"
            actionUrl="/app/marketing"
          />
        ) : (
          <BlockStack gap="300">
            <SectionHeader title="Recent Assets" description={`Last ${recentAssets.length} generated assets`} />
            <Card>
              <BlockStack gap="200">
                {(recentAssets as Array<{
                  id: string;
                  assetType: string;
                  platform: string;
                  content: string;
                  headline?: string | null;
                  tone: string;
                  status: string;
                  charCount?: number;
                  createdAt: string;
                }>).map((asset, idx) => (
                  <BlockStack key={asset.id} gap="100">
                    {idx > 0 ? <Divider /> : null}
                    <InlineStack align="space-between" blockAlign="start" wrap={false} gap="200">
                      <BlockStack gap="050">
                        <InlineStack gap="200" blockAlign="center" wrap>
                          <Badge tone="info">{ASSET_TYPE_LABELS[asset.assetType as MarketingAssetType] ?? asset.assetType}</Badge>
                          <Badge tone="info">{PLATFORM_LABELS[asset.platform as MarketingPlatform] ?? asset.platform}</Badge>
                          <Badge tone={STATUS_TONE[asset.status] ?? "info"}>{asset.status}</Badge>
                        </InlineStack>
                        {asset.headline ? (
                          <Text as="p" variant="bodySm" fontWeight="semibold">{asset.headline}</Text>
                        ) : null}
                        <Text as="p" variant="bodySm" tone="subdued">
                          {asset.content.slice(0, 120)}{asset.content.length > 120 ? "…" : ""}
                        </Text>
                      </BlockStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {new Date(asset.createdAt).toLocaleDateString()}
                      </Text>
                    </InlineStack>
                  </BlockStack>
                ))}
              </BlockStack>
            </Card>
          </BlockStack>
        )}
      </BlockStack>
    </AppPage>
  );
}
