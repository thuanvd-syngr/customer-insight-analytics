import { BlockStack } from "@shopify/polaris";
import type { ReactNode } from "react";

import { PageHeader } from "./PageHeader";

export function AppPage({
  title,
  subtitle,
  primaryAction,
  secondaryAction,
  children,
}: {
  title: string;
  subtitle?: string;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="cia-page">
      <BlockStack gap="500">
        <PageHeader
          title={title}
          subtitle={subtitle}
          primaryAction={primaryAction}
          secondaryAction={secondaryAction}
        />
        {children}
      </BlockStack>
    </div>
  );
}
