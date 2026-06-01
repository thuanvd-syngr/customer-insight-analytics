import { BlockStack, Text } from "@shopify/polaris";
import type { ReactNode } from "react";

export function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="cia-card cia-card-pad">
      <BlockStack gap="400">
        <BlockStack gap="050">
          <Text as="h2" variant="headingMd">
            {title}
          </Text>
          {subtitle ? (
            <Text as="p" variant="bodySm" tone="subdued">
              {subtitle}
            </Text>
          ) : null}
        </BlockStack>
        {children}
      </BlockStack>
    </div>
  );
}
