import { EmptyState } from "@shopify/polaris";
import type { ReactNode } from "react";

export interface EmptyInsightProps {
  heading: string;
  children?: ReactNode;
  primaryActionLabel?: string;
  primaryActionUrl?: string;
  secondaryActionLabel?: string;
  secondaryActionUrl?: string;
  image?: string;
}

const DEFAULT_IMAGE =
  "https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png";

/**
 * Consistent empty state used when a screen has no analyzed data yet.
 * Pass a <Form> via children for POST-based actions (e.g. load sample data).
 */
export function EmptyInsight({
  heading,
  children,
  primaryActionLabel,
  primaryActionUrl,
  secondaryActionLabel,
  secondaryActionUrl,
  image = DEFAULT_IMAGE,
}: EmptyInsightProps) {
  return (
    <EmptyState
      heading={heading}
      image={image}
      action={
        primaryActionLabel && primaryActionUrl
          ? { content: primaryActionLabel, url: primaryActionUrl }
          : undefined
      }
      secondaryAction={
        secondaryActionLabel && secondaryActionUrl
          ? { content: secondaryActionLabel, url: secondaryActionUrl }
          : undefined
      }
    >
      {children}
    </EmptyState>
  );
}
