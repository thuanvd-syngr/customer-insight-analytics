import { InlineStack, Text } from "@shopify/polaris";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  primaryAction,
  secondaryAction,
}: {
  title: string;
  subtitle?: string;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
}) {
  return (
    <div className="cia-page-header">
      <div>
        <Text as="h1" variant="heading2xl">
          {title}
        </Text>
        {subtitle ? (
          <Text as="p" variant="bodyMd" tone="subdued">
            {subtitle}
          </Text>
        ) : null}
      </div>
      {primaryAction || secondaryAction ? (
        <InlineStack gap="200" align="end" blockAlign="center">
          {secondaryAction}
          {primaryAction}
        </InlineStack>
      ) : null}
    </div>
  );
}
