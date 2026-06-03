import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { Badge, Banner, BlockStack, Button, Card, InlineGrid, InlineStack, Text } from "@shopify/polaris";

import { AppPage, EmptyInsight, ListSkeleton, SectionHeader, formatNumber } from "~/components";
import prisma from "~/db.server";
import { formActionKey, makeActionKey } from "~/lib/action-loading";
import { getDelegate } from "~/lib/prisma-safe";
import { buildSampleInsight, isReviewerMode } from "~/lib/reviewer-mode.server";
import { scanThemeContent } from "~/lib/revenue-automation";
import { ensureShop, getLatestRun, parseRun } from "~/lib/shop.server";
import { EMPTY_INSIGHT, normalizeInsightResult } from "~/lib/types";
import { authenticate } from "~/shopify.server";

type ActionResult = { scanned?: boolean; issueCount?: number; noContent?: boolean; error?: string };

async function context(request: Request) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  return { shop };
}

async function buildThemeText(shopId: string, sampleMode: boolean): Promise<string> {
  if (sampleMode) {
    return [
      "Sample product page",
      "Reviews",
      "Secure checkout",
      "Shipping",
    ].join("\n");
  }
  const product = getDelegate(prisma, "shopifyProduct");
  const published = getDelegate(prisma, "publishedContent");
  const [products, publishedItems] = await Promise.all([
    product?.findMany
      ? product.findMany({ where: { shopId }, take: 50, orderBy: { updatedAt: "desc" } })
      : [],
    published?.findMany
      ? published.findMany({ where: { shopId, status: "published" }, take: 50, orderBy: { publishedAt: "desc" } })
      : [],
  ]);
  return [
    ...products.flatMap((item: { title?: string; description?: string | null; tags?: string | null; productType?: string | null }) => [
      item.title ?? "",
      item.description ?? "",
      item.tags ?? "",
      item.productType ?? "",
    ]),
    ...publishedItems.flatMap((item: { contentType?: string; resourceTitle?: string }) => [
      item.contentType ?? "",
      item.resourceTitle ?? "",
    ]),
  ].join("\n");
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { shop } = await context(request);
    const sampleMode = await isReviewerMode(prisma, shop.id);
    const [latestRun, themeText] = await Promise.all([
      getLatestRun(prisma, shop.id),
      buildThemeText(shop.id, sampleMode),
    ]);
    const hasContent = themeText.trim().length > 0 || sampleMode;
    // Only run scanThemeContent when there is actual content to scan.
    // An empty themeText would produce all 6 phantom issues (every term absent),
    // which is misleading when no products have been synced yet.
    const insight = normalizeInsightResult(sampleMode ? buildSampleInsight() : (parseRun(latestRun) ?? EMPTY_INSIGHT));
    const issues = hasContent ? scanThemeContent({ themeText, insight }) : [];
    return json({
      hasThemeSignal: hasContent,
      isSampleMode: sampleMode,
      issues,
      scannedCharacters: themeText.length,
      requiresScan: !hasContent,
      loadError: null,
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Theme audit loader failed", error);
    return json({
      hasThemeSignal: false,
      isSampleMode: false,
      issues: [],
      scannedCharacters: 0,
      requiresScan: true,
      loadError: "Theme audit data is loading. Your store data is safe; refresh and scan again.",
    });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { shop } = await context(request);
    const sampleMode = await isReviewerMode(prisma, shop.id);
    const [latestRun, themeText] = await Promise.all([
      getLatestRun(prisma, shop.id),
      buildThemeText(shop.id, sampleMode),
    ]);
    const hasContent = themeText.trim().length > 0 || sampleMode;
    if (!hasContent) {
      return json<ActionResult>({ scanned: true, issueCount: 0, noContent: true });
    }
    const insight = normalizeInsightResult(sampleMode ? buildSampleInsight() : (parseRun(latestRun) ?? EMPTY_INSIGHT));
    const issues = scanThemeContent({ themeText, insight });
    return json<ActionResult>({ scanned: true, issueCount: issues.length });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Theme audit action failed", error);
    return json<ActionResult>({ error: "Theme scan failed. Check Shopify content access and try again." }, { status: 500 });
  }
}

function toneFor(severity: string): "critical" | "warning" | "info" {
  if (severity === "high") return "critical";
  if (severity === "medium") return "warning";
  return "info";
}

export default function ThemeAudit() {
  const { hasThemeSignal, isSampleMode, issues, scannedCharacters, requiresScan, loadError } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  if (navigation.state === "loading") return <ListSkeleton />;
  const scanActionKey = makeActionKey("theme:scan");
  const busy = navigation.state !== "idle" && formActionKey(navigation.formData) === scanActionKey;
  // Only show issues when there is real content scanned or a scan just ran.
  // Suppresses phantom issues that appear when no products are synced.
  const scanHasRun = actionData?.scanned && !actionData.noContent;
  const issuesReady = (scannedCharacters > 0 || isSampleMode) && !requiresScan;
  const visibleIssues = (issuesReady || scanHasRun) ? issues.filter((issue) => issue != null) : [];

  return (
    <AppPage
      title="Theme Content Scanner"
      subtitle="Find missing storefront content that can block purchases before shoppers reach checkout."
      primaryAction={
        <Form method="post">
          <input type="hidden" name="actionKey" value={scanActionKey} />
          <Button submit variant="primary" loading={busy} disabled={busy}>Scan Theme Content</Button>
        </Form>
      }
      secondaryAction={<Button url="/app/recovery">Open Recovery Plan</Button>}
    >
      <BlockStack gap="600">
        {isSampleMode ? (
          <Banner tone="info" title="Sample Data">
            <p>Reviewer Mode V2 is showing a sample theme audit. No sample data is written to the database.</p>
          </Banner>
        ) : null}
        {loadError ? <Banner tone="info" title="Theme audit loading"><p>{loadError}</p></Banner> : null}
        {actionData?.error ? <Banner tone="critical" title="Scan failed"><p>{actionData.error}</p></Banner> : null}
        {actionData?.scanned && !actionData.noContent ? (
          <Banner tone="success" title="Theme scan complete">
            <p>{`${formatNumber(actionData.issueCount ?? 0)} issues found in the latest scan.`}</p>
          </Banner>
        ) : null}
        {actionData?.scanned && actionData.noContent ? (
          <Banner tone="info" title="No content to scan yet">
            <p>Sync products or publish recovery content first, then scan again to find theme coverage gaps.</p>
          </Banner>
        ) : null}
        {requiresScan && !actionData?.scanned ? (
          <Banner tone="info" title="Sync products before scanning">
            <p>The scanner needs Shopify product text or published recovery assets. Import your store data, then click Scan to find content gaps.</p>
          </Banner>
        ) : null}

        <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">Theme Signals Scanned</Text>
              <Text as="p" variant="headingXl">{formatNumber(scannedCharacters)}</Text>
              <Text as="p" variant="bodySm">Product text and published recovery assets available to the app.</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">Open Issues</Text>
              <Text as="p" variant="headingXl">{formatNumber(visibleIssues.length)}</Text>
              <Text as="p" variant="bodySm">Missing sections ranked by estimated revenue impact.</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">Recommended Next Step</Text>
              <Text as="p" variant="headingMd">{visibleIssues[0]?.recommendedFix ?? "Recovery content coverage looks healthy"}</Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        {!hasThemeSignal ? (
          <Card>
            <EmptyInsight
              heading="Sync products or publish content to scan your storefront coverage"
              primaryActionLabel="Import store data"
              primaryActionUrl="/app/import"
              secondaryActionLabel="Open publish hub"
              secondaryActionUrl="/app/publish"
            >
              <p>The scanner needs Shopify product text or published recovery assets to identify missing theme content.</p>
            </EmptyInsight>
          </Card>
        ) : null}

        <BlockStack gap="300">
          <SectionHeader title="Theme Audit Issues" description="Each issue maps to a concrete recovery action." />
          {visibleIssues.length === 0 ? (
            <Card>
              <BlockStack gap="100">
                <Text as="h3" variant="headingMd">No major content gaps found</Text>
                <Text as="p" variant="bodyMd" tone="subdued">Keep monitoring customer questions and publish new recovery content when friction appears.</Text>
              </BlockStack>
            </Card>
          ) : (
            <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
              {visibleIssues.map((issue) => (
                <Card key={issue.id}>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="start" wrap={false}>
                      <Text as="h3" variant="headingMd">{issue.issue}</Text>
                      <Badge tone={toneFor(issue.severity)}>{issue.severity}</Badge>
                    </InlineStack>
                    <Text as="p" variant="bodyMd">{issue.impact}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">{issue.recommendedFix}</Text>
                    <InlineStack gap="200">
                      <Button url="/app/recovery" size="slim" variant="primary">Add to Recovery Plan</Button>
                      <Button url="/app/publish" size="slim">Publish Fix</Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              ))}
            </InlineGrid>
          )}
        </BlockStack>
      </BlockStack>
    </AppPage>
  );
}
