import { Box, InlineStack } from "@shopify/polaris";
import type { ReactNode } from "react";

export interface StickyActionBarProps {
  children: ReactNode;
  /** Alignment of the action group. */
  align?: "start" | "center" | "end" | "space-between";
}

/**
 * A sticky bottom action bar (like Triple Whale / Polaris contextual save bar)
 * for primary actions on detail pages. Polaris Box surface + a sticky wrapper.
 */
export function StickyActionBar({
  children,
  align = "end",
}: StickyActionBarProps) {
  return (
    <div
      style={{
        position: "sticky",
        bottom: 0,
        zIndex: 20,
        marginTop: "var(--p-space-400, 16px)",
      }}
    >
      <Box
        background="bg-surface"
        padding="400"
        borderRadius="300"
        borderColor="border"
        borderWidth="025"
        shadow="300"
      >
        <InlineStack align={align} blockAlign="center" gap="300">
          {children}
        </InlineStack>
      </Box>
    </div>
  );
}
