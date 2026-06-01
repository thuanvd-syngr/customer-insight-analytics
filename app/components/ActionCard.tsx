import { BlockStack, Button, InlineStack, Text } from "@shopify/polaris";

import { moneyRange } from "./format";
import { SeverityBadge } from "./SeverityBadge";
import type { PriorityLevel } from "./PriorityBadge";

export function ActionCard({
  title,
  priority,
  customersAffected,
  low,
  high,
  action,
  ctaLabel = "Fix this issue",
  ctaUrl,
}: {
  title: string;
  priority: PriorityLevel;
  customersAffected: number;
  low?: number;
  high?: number;
  action: string;
  ctaLabel?: string;
  ctaUrl: string;
}) {
  const hasEstimate = (high || 0) > 0;
  return (
    <div className="cia-card cia-card-pad">
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start" gap="200">
          <Text as="h3" variant="headingMd">
            {title}
          </Text>
          <SeverityBadge level={priority} />
        </InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">
          {customersAffected > 0 ? `${customersAffected} customers affected` : "Add customer questions to unlock this recommendation"}
        </Text>
        <Text as="p" variant="headingLg" tone={hasEstimate ? "success" : "subdued"}>
          {hasEstimate ? `${moneyRange(low, high)}/mo` : "Recovery estimate pending"}
        </Text>
        <Text as="p" variant="bodyMd">
          {action}
        </Text>
        <Button url={ctaUrl} variant="primary">
          {ctaLabel}
        </Button>
      </BlockStack>
    </div>
  );
}
