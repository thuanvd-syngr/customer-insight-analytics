import type { ReactNode } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Divider,
  InlineStack,
  List,
  Text,
} from "@shopify/polaris";

import prisma from "~/db.server";
import { ensureShop } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";
import { AppPage, SectionHeader } from "~/components";
import { safeCount } from "~/lib/prisma-safe";

type WidgetStatus = "locked" | "needs_setup" | "ready";

function getWidgetStatus(canUse: boolean, publishedFaqCount: number): WidgetStatus {
  if (!canUse) return "locked";
  if (publishedFaqCount === 0) return "needs_setup";
  return "ready";
}

const STATUS_COPY: Record<WidgetStatus, { label: string; tone: "success" | "info" | "warning" }> = {
  locked: { label: "Locked — Growth plan required", tone: "warning" },
  needs_setup: { label: "Needs setup — no FAQs published yet", tone: "info" },
  ready: { label: "Ready", tone: "success" },
};

const DEMO_JSON_LD = `{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is your return policy?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Returns accepted within 30 days. Items must be unused and in original packaging."
      }
    },
    {
      "@type": "Question",
      "name": "Do you offer free shipping?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Free standard shipping on orders over $75. Expedited options at checkout."
      }
    }
  ]
}`;

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { session } = await authenticate.admin(request);
    const shop = await ensureShop(prisma, session.shop);
    const storeDomain = session.shop.replace(".myshopify.com", "");
    const canUseWidget = shop.plan === "growth" || shop.plan === "pro";

    const publishedFaqCount = await safeCount(prisma, "generatedFaq", {
      where: { shopId: shop.id, status: "published" },
    });

    const status = getWidgetStatus(canUseWidget, publishedFaqCount);
    return json({ plan: shop.plan, storeDomain, shopDomain: session.shop, canUseWidget, publishedFaqCount, status, loadError: null });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Widget loader failed", error);
    return json({ plan: "free", storeDomain: "", shopDomain: "", canUseWidget: false, publishedFaqCount: 0, status: "locked" as WidgetStatus, loadError: "Widget data is loading. Refresh in a moment." });
  }
}

export default function WidgetPage() {
  const { plan, storeDomain, shopDomain, canUseWidget, publishedFaqCount, status, loadError } = useLoaderData<typeof loader>();
  const themeEditorUrl = `https://${shopDomain}/admin/themes/current/editor`;
  const faqMetafieldNs = "customer_insight.faq_json";
  const statusInfo = STATUS_COPY[status];

  return (
    <AppPage
      title="Product FAQ Widget"
      subtitle="Display product-specific recovery FAQs directly on your product pages."
      primaryAction={
        canUseWidget ? (
          <Button url={themeEditorUrl} variant="primary" target="_blank">Open Theme Editor</Button>
        ) : (
          <Button url="/app/billing" variant="primary">Upgrade to Growth</Button>
        )
      }
      secondaryAction={<Button url="/app/faq">Manage FAQs</Button>}
    >
      <BlockStack gap="500">
        {loadError ? <Banner tone="info" title="Widget data loading"><p>{loadError}</p></Banner> : null}

        {status === "locked" ? (
          <Banner tone="warning" title="Growth or Pro plan required">
            <p>The Product FAQ Widget is available on the Growth plan ($49/mo) and above. Upgrade to embed FAQ content directly on your product pages with JSON-LD schema.</p>
            <Button url="/app/billing" variant="plain">See plans</Button>
          </Banner>
        ) : status === "needs_setup" ? (
          <Banner tone="info" title="Publish FAQs before activating the widget">
            <p>You have no published product FAQs yet. Generate and publish at least one FAQ, then add the widget block to your theme.</p>
            <Button url="/app/faq" variant="plain">Go to FAQ Builder</Button>
          </Banner>
        ) : (
          <Banner tone="success" title={`Widget is ready — ${publishedFaqCount} FAQ${publishedFaqCount === 1 ? "" : "s"} published`}>
            <p>Add the Product FAQ block to your product page template in the Theme Editor. The widget will automatically display published FAQs on the matching product pages.</p>
            <Button url={themeEditorUrl} target="_blank" variant="plain">Open Theme Editor</Button>
          </Banner>
        )}

        <div className="cia-metric-strip">
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Widget Status</div>
            <Badge tone={statusInfo.tone}>{statusInfo.label}</Badge>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Published FAQs</div>
            <Text as="p" variant="headingLg">{publishedFaqCount}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Extension Type</div>
            <Text as="p" variant="headingMd">Theme App Block</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Metafield Namespace</div>
            <Text as="p" variant="bodyMd" tone="subdued">{faqMetafieldNs}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Store</div>
            <Text as="p" variant="bodyMd">{storeDomain}</Text>
          </div>
        </div>

        {/* Activation checklist */}
        <Card>
          <BlockStack gap="300">
            <SectionHeader
              title="Activation Checklist"
              description="Complete these 4 steps to show FAQ content on your product pages."
            />
            {([
              {
                done: plan === "growth" || plan === "pro",
                label: "Upgrade to Growth or Pro plan",
                detail: "Required to enable the Theme App Block and metafield publishing.",
                cta: <Button url="/app/billing" size="slim">View Plans</Button>,
              },
              {
                done: publishedFaqCount > 0,
                label: "Publish at least one product FAQ",
                detail: "Use the FAQ Builder to generate and publish FAQ content for your products.",
                cta: <Button url="/app/faq" size="slim">Open FAQ Builder</Button>,
              },
              {
                done: false,
                label: "Add the Product FAQ block to your theme",
                detail: "In Theme Editor: Add block → Apps → Product FAQ. Drag to position on product page.",
                cta: canUseWidget ? <Button url={themeEditorUrl} target="_blank" size="slim">Open Theme Editor</Button> : null,
              },
              {
                done: false,
                label: "Save and preview the theme",
                detail: "Click Save in Theme Editor and visit a product page to confirm FAQs appear.",
                cta: null,
              },
            ] as Array<{ done: boolean; label: string; detail: string; cta: ReactNode }>).map((step, idx) => (
              <BlockStack key={idx} gap="100">
                {idx > 0 ? <Divider /> : null}
                <InlineStack align="space-between" blockAlign="center" gap="300" wrap={false}>
                  <BlockStack gap="050">
                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone={step.done ? "success" : "info"}>{step.done ? "Done" : `Step ${idx + 1}`}</Badge>
                      <Text as="p" variant="bodyMd" fontWeight={step.done ? undefined : "semibold"}>{step.label}</Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">{step.detail}</Text>
                  </BlockStack>
                  {!step.done && step.cta ? step.cta : null}
                </InlineStack>
              </BlockStack>
            ))}
          </BlockStack>
        </Card>

        <div className="cia-two-grid">
          <Card>
            <BlockStack gap="300">
              <SectionHeader title="How to add the FAQ block" description="Step-by-step guide to embedding FAQ content on your product pages." />
              <List type="number">
                <List.Item>Click <strong>Open Theme Editor</strong> above.</List.Item>
                <List.Item>Navigate to a product page template (Products › Default product).</List.Item>
                <List.Item>Click <strong>Add block</strong> in the left sidebar.</List.Item>
                <List.Item>Search for <strong>Product FAQ</strong> under Apps.</List.Item>
                <List.Item>Drag the block to the desired position on the product page.</List.Item>
                <List.Item>Configure heading text, accordion style, and max FAQ count in the block settings.</List.Item>
                <List.Item>Click <strong>Save</strong>. FAQs appear automatically when present.</List.Item>
              </List>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <SectionHeader title="How FAQ content is delivered" description="The widget reads from a Shopify metafield automatically set when you publish product FAQs." />
              <BlockStack gap="200">
                {[
                  { tone: "info" as const, text: <>Generate a Product FAQ in the <strong>FAQ</strong> section.</> },
                  { tone: "info" as const, text: <>Publish it — the app writes the FAQ JSON to the product metafield <code>{faqMetafieldNs}</code>.</> },
                  { tone: "info" as const, text: <>The widget block reads the metafield and renders the FAQ accordion with JSON-LD schema automatically.</> },
                  { tone: "success" as const, text: <>Google indexes the FAQ schema, improving SEO while reducing buyer questions.</> },
                ].map((item, idx) => (
                  <InlineStack key={idx} gap="200" blockAlign="start">
                    <Badge tone={item.tone}>{String(idx + 1)}</Badge>
                    <Text as="p" variant="bodyMd">{item.text}</Text>
                  </InlineStack>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        </div>

        {/* JSON-LD demo preview */}
        <Card>
          <BlockStack gap="300">
            <SectionHeader
              title="JSON-LD FAQ Schema Preview"
              description="Example of what search engines see. The widget generates this automatically from your published FAQs."
            />
            <Text as="p" variant="bodySm" tone="subdued">
              The widget generates <code>FAQPage</code> JSON-LD schema automatically. No configuration needed — Google and Bing pick up structured data within days of indexing. Check Google Search Console under Rich Results to confirm.
            </Text>
            <pre style={{ background: "#f4f6f8", borderRadius: "6px", padding: "12px 16px", fontSize: "12px", lineHeight: "1.5", overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {DEMO_JSON_LD}
            </pre>
            <Button url="/app/faq">Manage FAQ content</Button>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <SectionHeader title="Block settings" description="Configure these options inside the Shopify Theme Editor after adding the block." />
            <div className="cia-three-grid">
              <BlockStack gap="100">
                <Text as="p" variant="headingSm">Accordion style</Text>
                <Text as="p" variant="bodySm" tone="subdued">Enable for a collapsible FAQ list. Disable to show all answers expanded.</Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="p" variant="headingSm">Max FAQs per product</Text>
                <Text as="p" variant="bodySm" tone="subdued">Limit how many questions are shown (1–20). Defaults to 6.</Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="p" variant="headingSm">FAQ categories</Text>
                <Text as="p" variant="bodySm" tone="subdued">Toggle shipping, return, warranty, and payment FAQ sections on/off per block.</Text>
              </BlockStack>
            </div>
          </BlockStack>
        </Card>
      </BlockStack>
    </AppPage>
  );
}
