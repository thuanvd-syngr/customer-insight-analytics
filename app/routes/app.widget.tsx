import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  InlineStack,
  List,
  Text,
} from "@shopify/polaris";

import prisma from "~/db.server";
import { ensureShop } from "~/lib/shop.server";
import { authenticate } from "~/shopify.server";
import { AppPage, SectionHeader } from "~/components";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = await ensureShop(prisma, session.shop);
  const storeDomain = session.shop.replace(".myshopify.com", "");
  return json({ plan: shop.plan, storeDomain, shopDomain: session.shop });
}

export default function WidgetPage() {
  const { plan, storeDomain, shopDomain } = useLoaderData<typeof loader>();
  const canUseWidget = plan === "growth" || plan === "pro";

  const themeEditorUrl = `https://${shopDomain}/admin/themes/current/editor`;
  const faqMetafieldNs = "customer_insight.faq_json";

  return (
    <AppPage
      title="Product FAQ Widget"
      subtitle="Display product-specific recovery FAQs directly on your product pages."
      primaryAction={
        canUseWidget ? (
          <Button url={themeEditorUrl} variant="primary" target="_blank">
            Open Theme Editor
          </Button>
        ) : (
          <Button url="/app/billing" variant="primary">Upgrade to Growth</Button>
        )
      }
      secondaryAction={<Button url="/app/faq">Manage FAQs</Button>}
    >
      <BlockStack gap="500">
        {!canUseWidget ? (
          <Banner tone="warning" title="Growth or Pro plan required">
            <p>
              The Product FAQ Widget is available on the Growth plan ($49/mo) and above.
              Upgrade to embed FAQ content directly on your product pages with JSON-LD schema.
            </p>
          </Banner>
        ) : null}

        <div className="cia-metric-strip">
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Widget Status</div>
            <Badge tone={canUseWidget ? "success" : "warning"}>
              {canUseWidget ? "Available" : "Locked"}
            </Badge>
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

        <div className="cia-two-grid">
          <Card>
            <BlockStack gap="300">
              <SectionHeader
                title="How to add the FAQ block"
                description="Step-by-step guide to embedding FAQ content on your product pages."
              />
              <List type="number">
                <List.Item>
                  Click <strong>Open Theme Editor</strong> above.
                </List.Item>
                <List.Item>
                  Navigate to a product page template (Products › Default product).
                </List.Item>
                <List.Item>
                  Click <strong>Add block</strong> in the left sidebar.
                </List.Item>
                <List.Item>
                  Search for <strong>Product FAQ</strong> under Apps.
                </List.Item>
                <List.Item>
                  Drag the block to the desired position on the product page.
                </List.Item>
                <List.Item>
                  Configure heading text, accordion style, and max FAQ count in the block settings.
                </List.Item>
                <List.Item>
                  Click <strong>Save</strong>. FAQs appear automatically when present.
                </List.Item>
              </List>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <SectionHeader
                title="How FAQ content is delivered"
                description="The widget reads from a Shopify metafield automatically set when you publish product FAQs."
              />
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="start">
                  <Badge tone="info">1</Badge>
                  <Text as="p" variant="bodyMd">
                    Generate a Product FAQ in the <strong>FAQ</strong> section.
                  </Text>
                </InlineStack>
                <InlineStack gap="200" blockAlign="start">
                  <Badge tone="info">2</Badge>
                  <Text as="p" variant="bodyMd">
                    Publish it — the app writes the FAQ JSON to the product metafield <code>{faqMetafieldNs}</code>.
                  </Text>
                </InlineStack>
                <InlineStack gap="200" blockAlign="start">
                  <Badge tone="info">3</Badge>
                  <Text as="p" variant="bodyMd">
                    The widget block reads the metafield and renders the FAQ accordion with JSON-LD schema automatically.
                  </Text>
                </InlineStack>
                <InlineStack gap="200" blockAlign="start">
                  <Badge tone="success">4</Badge>
                  <Text as="p" variant="bodyMd">
                    Google indexes the FAQ schema, improving SEO while reducing buyer questions.
                  </Text>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Card>
        </div>

        <Card>
          <BlockStack gap="300">
            <SectionHeader
              title="Block settings"
              description="Configure these options inside the Shopify Theme Editor after adding the block."
            />
            <div className="cia-three-grid">
              <BlockStack gap="100">
                <Text as="p" variant="headingSm">Accordion style</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Enable for a collapsible FAQ list. Disable to show all answers expanded.
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="p" variant="headingSm">Max FAQs per product</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Limit how many questions are shown (1–20). Defaults to 6.
                </Text>
              </BlockStack>
              <BlockStack gap="100">
                <Text as="p" variant="headingSm">FAQ categories</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Toggle shipping, return, warranty, and payment FAQ sections on/off per block.
                </Text>
              </BlockStack>
            </div>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <SectionHeader
              title="JSON-LD FAQ Schema"
              description="Every FAQ block automatically outputs structured data for search engines."
            />
            <Text as="p" variant="bodySm" tone="subdued">
              The widget generates <code>FAQPage</code> JSON-LD schema automatically from your published FAQ content.
              No configuration needed — Google and Bing will pick up the structured data within days of indexing.
              Check Google Search Console under Rich Results to confirm indexing.
            </Text>
            <Button url="/app/faq">Manage FAQ content</Button>
          </BlockStack>
        </Card>
      </BlockStack>
    </AppPage>
  );
}
