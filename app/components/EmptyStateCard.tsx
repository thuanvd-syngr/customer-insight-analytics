import { BlockStack, Button, Text } from "@shopify/polaris";

export function EmptyStateCard({
  title,
  body,
  actionLabel,
  actionUrl,
}: {
  title: string;
  body: string;
  actionLabel: string;
  actionUrl: string;
}) {
  return (
    <div className="cia-card cia-card-pad">
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          {title}
        </Text>
        <Text as="p" variant="bodyMd" tone="subdued">
          {body}
        </Text>
        <Button url={actionUrl} variant="primary">
          {actionLabel}
        </Button>
      </BlockStack>
    </div>
  );
}
