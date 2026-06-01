import { Link } from "@remix-run/react";
import { BlockStack, InlineStack, Text } from "@shopify/polaris";
import type { ReactNode } from "react";

export interface SectionHeaderProps {
  title: string;
  description?: string;
  actionLabel?: string;
  actionUrl?: string;
  /** Optional trailing node (e.g. a Badge or TrendIndicator). */
  trailing?: ReactNode;
}

/** Consistent section header with optional inline action / trailing content. */
export function SectionHeader({
  title,
  description,
  actionLabel,
  actionUrl,
  trailing,
}: SectionHeaderProps) {
  return (
    <InlineStack align="space-between" blockAlign="center" wrap={false}>
      <BlockStack gap="050">
        <Text as="h2" variant="headingMd">
          {title}
        </Text>
        {description ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {description}
          </Text>
        ) : null}
      </BlockStack>
      <InlineStack gap="200" blockAlign="center">
        {trailing}
        {actionLabel && actionUrl ? (
          <Link to={actionUrl}>{actionLabel}</Link>
        ) : null}
      </InlineStack>
    </InlineStack>
  );
}
