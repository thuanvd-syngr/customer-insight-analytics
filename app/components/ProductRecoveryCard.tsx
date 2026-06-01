import { Badge, BlockStack, Button, InlineStack, Text } from "@shopify/polaris";

import { moneyRange } from "./format";

export function ProductRecoveryCard({
  title,
  detailUrl,
  customersAffected,
  topIssue,
  low,
  high,
  missingContent,
  exampleQuestion,
  score,
  contentCompleteness,
  competitorPressure,
}: {
  title: string;
  detailUrl: string;
  customersAffected: number;
  topIssue?: string;
  low?: number;
  high?: number;
  missingContent: string[];
  exampleQuestion?: string;
  score?: number;
  contentCompleteness?: number;
  competitorPressure?: number;
}) {
  const hasEstimate = (high || 0) > 0;
  return (
    <div className="cia-card cia-card-pad">
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="start" gap="200">
          <Text as="h3" variant="headingMd">
            {title}
          </Text>
          {typeof score === "number" ? <Badge tone={score >= 50 ? "warning" : "info"}>{`Recovery score ${score}/100`}</Badge> : null}
        </InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">
          {customersAffected} customers affected
        </Text>
        <div className="cia-metric-strip">
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Questions asked</div>
            <Text as="p" variant="headingMd">{customersAffected}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Content completeness</div>
            <Text as="p" variant="headingMd">{typeof contentCompleteness === "number" ? `${contentCompleteness}%` : "Sync content"}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Competitor pressure</div>
            <Text as="p" variant="headingMd">{typeof competitorPressure === "number" ? `${competitorPressure}/100` : "Low"}</Text>
          </div>
          <div className="cia-muted-panel">
            <div className="cia-eyebrow">Recovery priority</div>
            <Text as="p" variant="headingMd">{score && score >= 50 ? "High" : score && score >= 25 ? "Medium" : "Watch"}</Text>
          </div>
        </div>
        {hasEstimate ? (
          <Text as="p" variant="headingLg" tone="success">
            {`${moneyRange(low, high)}/mo recovery potential`}
          </Text>
        ) : null}
        <Text as="p" variant="bodyMd">
          Priority action: {topIssue ? `Create revenue recovery content for ${topIssue}` : "Sync Shopify content and analyze customer questions"}
        </Text>
        <InlineStack gap="100">
          {missingContent.length ? (
            missingContent.slice(0, 3).map((section) => (
              <Badge key={section} tone="warning">
                {section}
              </Badge>
            ))
          ) : (
            <Badge tone="info">Sync content</Badge>
          )}
        </InlineStack>
        {exampleQuestion ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {`"${exampleQuestion}"`}
          </Text>
        ) : null}
        <InlineStack gap="200">
          <Button url={detailUrl}>View recovery plan</Button>
          <Button url="/app/faq" variant="primary">Generate Content</Button>
          <Button url="/app/faq">Generate FAQ</Button>
          {competitorPressure && competitorPressure > 0 ? <Button url="/app/competitors">Create Comparison Page</Button> : null}
        </InlineStack>
      </BlockStack>
    </div>
  );
}
