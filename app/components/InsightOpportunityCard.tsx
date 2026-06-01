import { BlockStack, Box, Button, InlineStack, Text } from "@shopify/polaris";
import { Form } from "@remix-run/react";

import { moneyRange } from "./format";
import type { PriorityLevel } from "./PriorityBadge";
import { SeverityBadge } from "./SeverityBadge";
import { TrendIndicator } from "./TrendIndicator";

export function InsightOpportunityCard({
  groupId,
  topic,
  priority,
  customersAffected,
  trend,
  low,
  high,
  quote,
  action,
}: {
  groupId: string;
  topic: string;
  priority: PriorityLevel;
  customersAffected: number;
  trend: number;
  low?: number;
  high?: number;
  quote?: string;
  action: string;
}) {
  const hasEstimate = (high || 0) > 0;
  return (
    <div className="cia-card cia-card-pad">
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="start" gap="200">
          <Text as="h3" variant="headingMd">
            {topic}
          </Text>
          <SeverityBadge level={priority} />
        </InlineStack>
        <InlineStack gap="300" blockAlign="center">
          <Text as="span" variant="bodySm" tone="subdued">
            {customersAffected} customers affected
          </Text>
          <TrendIndicator value={trend} suffix="vs last week" />
        </InlineStack>
        <Text as="p" variant="headingLg" tone={hasEstimate ? "success" : "subdued"}>
          {hasEstimate ? `${moneyRange(low, high)}/mo` : "Connect orders to unlock recovery estimates"}
        </Text>
        {quote ? (
          <Box background="bg-surface-secondary" borderRadius="200" padding="300">
            <Text as="p" variant="bodyMd" tone="subdued">
              <em>{`"${quote}"`}</em>
            </Text>
          </Box>
        ) : null}
        <BlockStack gap="100">
          <Text as="span" variant="bodySm" tone="subdued">
            Recommended fix
          </Text>
          <Text as="p" variant="bodyMd">
            {action}
          </Text>
        </BlockStack>
        <InlineStack gap="200">
          <Form method="post" action="/app/faq">
            <input type="hidden" name="intent" value="save" />
            <input type="hidden" name="groupId" value={groupId} />
            <input type="hidden" name="question" value={`What should customers know about ${topic.toLowerCase()}?`} />
            <Button submit variant="primary">
              Generate Fix
            </Button>
          </Form>
          <Button url="/app/products">View products</Button>
        </InlineStack>
      </BlockStack>
    </div>
  );
}
