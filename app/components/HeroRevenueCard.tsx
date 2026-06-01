import { BlockStack, Button, InlineGrid, InlineStack, Text } from "@shopify/polaris";

import { moneyRange, formatNumber } from "./format";
import { MetricBadge } from "./MetricBadge";

export function HeroRevenueCard({
  low,
  high,
  customersAffected,
  topIssue,
  actionUrl,
}: {
  low?: number;
  high?: number;
  customersAffected: number;
  topIssue?: string | null;
  actionUrl: string;
}) {
  const hasEstimate = (high || 0) > 0;
  return (
    <div className="cia-card cia-card-pad cia-revenue-hero">
      <BlockStack gap="500">
        <InlineStack align="space-between" blockAlign="start" gap="300">
          <BlockStack gap="100">
            <Text as="p" variant="bodySm" tone="subdued">
              Revenue Opportunity
            </Text>
            <Text as="h2" variant="heading2xl">
              {hasEstimate ? `${moneyRange(low, high)}/mo` : "Connect orders to unlock recovery estimates"}
            </Text>
          </BlockStack>
          <MetricBadge tone={hasEstimate ? "success" : "warning"}>
            {hasEstimate ? "Calculated" : "Needs order data"}
          </MetricBadge>
        </InlineStack>
        <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
          <div className="cia-muted-panel">
            <Text as="p" variant="bodySm" tone="subdued">
              Customers affected
            </Text>
            <Text as="p" variant="headingLg">
              {customersAffected > 0 ? formatNumber(customersAffected) : "Store health needs order history"}
            </Text>
          </div>
          <div className="cia-muted-panel">
            <Text as="p" variant="bodySm" tone="subdued">
              Top issue
            </Text>
            <Text as="p" variant="headingLg">
              {topIssue || "Add customer questions to reveal recovery actions"}
            </Text>
          </div>
        </InlineGrid>
        {!hasEstimate ? (
          <Text as="p" variant="bodySm" tone="subdued">
            Sync Shopify orders or set average order value to calculate recovery potential.
          </Text>
        ) : null}
        <Button url={actionUrl} variant="primary">
          View recovery plan
        </Button>
      </BlockStack>
    </div>
  );
}
