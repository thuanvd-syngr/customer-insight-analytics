import { InlineStack, Text } from "@shopify/polaris";

import { formatPercent, textTone, trendTone } from "./format";

export interface TrendIndicatorProps {
  /** Trend ratio, e.g. 0.5 === +50%. */
  value: number;
  /** When true, rising is good (e.g. health score). Default: rising is bad. */
  invert?: boolean;
  /** Optional suffix such as "vs last week". */
  suffix?: string;
}

/**
 * Compact ▲/▼ trend chip coloured by whether the movement is good or bad.
 * Friction trends rise = bad (critical); pass invert for "up is good" metrics.
 */
export function TrendIndicator({ value, invert, suffix }: TrendIndicatorProps) {
  const tone = trendTone(value, invert);
  const flat = Math.abs(value || 0) < 0.001;
  const arrow = flat ? "→" : (value || 0) > 0 ? "▲" : "▼";

  return (
    <InlineStack gap="100" blockAlign="center">
      <Text as="span" variant="bodySm" tone={textTone(tone)} fontWeight="semibold">
        {`${arrow} ${formatPercent(value)}`}
      </Text>
      {suffix ? (
        <Text as="span" variant="bodySm" tone="subdued">
          {suffix}
        </Text>
      ) : null}
    </InlineStack>
  );
}
