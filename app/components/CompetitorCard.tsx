import { Badge, BlockStack, Button, InlineStack, Text } from "@shopify/polaris";

export function CompetitorCard({
  name,
  mentions,
  reasons,
  quote,
  recommendation,
  affectedProducts,
}: {
  name: string;
  mentions: number;
  reasons: string[];
  quote?: string;
  recommendation: string;
  affectedProducts: string[];
}) {
  const threatScore = Math.min(100, Math.round(mentions * 12 + affectedProducts.length * 10));
  return (
    <div className="cia-card cia-card-pad">
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start" gap="200">
          <Text as="h3" variant="headingMd">
            {name}
          </Text>
          <Badge tone={threatScore >= 50 ? "critical" : mentions >= 3 ? "warning" : "info"}>{`Threat score ${threatScore}/100`}</Badge>
        </InlineStack>
        <InlineStack gap="200">
          <Badge tone="info">{`${mentions} customer concerns`}</Badge>
          <Badge tone="warning">{`${affectedProducts.length || "Storewide"} affected products`}</Badge>
        </InlineStack>
        <BlockStack gap="100">
          <Text as="span" variant="bodySm" tone="subdued">
            Customer concerns
          </Text>
          <InlineStack gap="100">
            {reasons.map((reason) => (
              <Badge key={reason} tone="info">
                {reason}
              </Badge>
            ))}
          </InlineStack>
        </BlockStack>
        {quote ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {`"${quote}"`}
          </Text>
        ) : null}
        <Text as="p" variant="bodyMd">
          Suggested response: {recommendation}
        </Text>
        <div className="cia-muted-panel">
          <BlockStack gap="200">
            <Text as="span" variant="bodySm" tone="subdued">
              Most affected products
            </Text>
            <InlineStack gap="100">
              {affectedProducts.length > 0 ? (
                affectedProducts.slice(0, 3).map((product) => <Badge key={product}>{product}</Badge>)
              ) : (
                <Badge tone="info">Storewide comparison</Badge>
              )}
            </InlineStack>
            <Text as="p" variant="bodySm">
              Recommended content: comparison FAQ, proof points, and guarantee copy.
            </Text>
            <Text as="p" variant="bodySm">
              FAQ opportunity: Why choose us over {name}?
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Merchant action: publish proof, guarantees, and pricing clarity near the buy button.
            </Text>
          </BlockStack>
        </div>
        <Button url="/app/faq" variant="primary">
          Generate Comparison FAQ
        </Button>
      </BlockStack>
    </div>
  );
}
