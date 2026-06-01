import { BlockStack, Box, InlineStack, Text } from "@shopify/polaris";

import { formatNumber, type Tone } from "./format";

export interface BarDatum {
  label: string;
  value: number;
  /** Optional formatted value override (e.g. money()). */
  display?: string;
  /** Optional per-bar tone override. */
  tone?: Tone;
}

export interface BarChartProps {
  data: BarDatum[];
  /** Default bar tone. */
  tone?: Tone;
  /** Max bars to show. */
  limit?: number;
}

const BG: Record<Tone, "bg-fill-success" | "bg-fill-caution" | "bg-fill-critical" | "bg-fill-info" | "bg-fill-secondary"> = {
  success: "bg-fill-success",
  warning: "bg-fill-caution",
  critical: "bg-fill-critical",
  info: "bg-fill-info",
  subdued: "bg-fill-secondary",
};

/**
 * Horizontal bar chart built entirely from Polaris Box primitives (no chart
 * library). Useful for friction breakdowns and revenue drivers.
 */
export function BarChart({ data, tone = "info", limit }: BarChartProps) {
  const rows = (limit ? data.slice(0, limit) : data).filter(Boolean);
  const max = Math.max(1, ...rows.map((r) => r.value || 0));

  if (rows.length === 0) {
    return (
      <Text as="p" tone="subdued" variant="bodySm">
        Import customer conversations to unlock insights.
      </Text>
    );
  }

  return (
    <BlockStack gap="300">
      {rows.map((row) => {
        const pct = Math.max(2, Math.round(((row.value || 0) / max) * 100));
        return (
          <BlockStack gap="100" key={row.label}>
            <InlineStack align="space-between" blockAlign="center">
              <Text as="span" variant="bodySm">
                {row.label}
              </Text>
              <Text as="span" variant="bodySm" fontWeight="semibold">
                {row.display ?? formatNumber(row.value)}
              </Text>
            </InlineStack>
            <Box background="bg-surface-secondary" borderRadius="full" minHeight="10px">
              <Box
                background={BG[row.tone ?? tone]}
                borderRadius="full"
                minHeight="10px"
                width={`${pct}%`}
              />
            </Box>
          </BlockStack>
        );
      })}
    </BlockStack>
  );
}
