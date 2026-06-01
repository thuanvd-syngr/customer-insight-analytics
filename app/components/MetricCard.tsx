import { Link } from "@remix-run/react";
import {
  BlockStack,
  Box,
  Card,
  InlineStack,
  ProgressBar,
  Text,
  Tooltip,
} from "@shopify/polaris";
import type { ReactNode } from "react";

import { progressTone, type Tone } from "./format";
import { TrendIndicator } from "./TrendIndicator";

export interface MetricCardProps {
  title: string;
  /** Pre-formatted primary value, e.g. money() or "72/100". */
  value: ReactNode;
  sublabel?: string;
  /** Trend ratio (0.5 === +50%). */
  trend?: number;
  /** When true, a rising trend is good (health-style). */
  trendInvert?: boolean;
  /** 0..100 progress bar under the value. */
  progress?: number;
  tone?: Tone;
  actionLabel?: string;
  actionUrl?: string;
  /** Tooltip help text shown next to the title. */
  helpText?: string;
  /** Optional leading visual (e.g. a ScoreGauge). */
  media?: ReactNode;
}

/**
 * The hero metric card used across the dashboard and reports. Polaris-only:
 * title, big value, optional trend indicator, progress bar, and an action.
 */
export function MetricCard({
  title,
  value,
  sublabel,
  trend,
  trendInvert,
  progress,
  tone = "info",
  actionLabel,
  actionUrl,
  helpText,
  media,
}: MetricCardProps) {
  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          {helpText ? (
            <Tooltip content={helpText}>
              <Text as="h3" variant="headingSm" tone="subdued">
                {title}
              </Text>
            </Tooltip>
          ) : (
            <Text as="h3" variant="headingSm" tone="subdued">
              {title}
            </Text>
          )}
          {typeof trend === "number" ? (
            <TrendIndicator value={trend} invert={trendInvert} />
          ) : null}
        </InlineStack>

        <InlineStack gap="300" blockAlign="center" wrap={false}>
          {media ? <Box>{media}</Box> : null}
          <div className="cia-metric-value">{value}</div>
        </InlineStack>

        {typeof progress === "number" ? (
          <ProgressBar
            progress={Math.max(0, Math.min(100, progress))}
            tone={progressTone(tone)}
            size="small"
          />
        ) : null}

        {sublabel ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {sublabel}
          </Text>
        ) : null}

        {actionLabel && actionUrl ? (
          <Box>
            <Link to={actionUrl}>{actionLabel}</Link>
          </Box>
        ) : null}
      </BlockStack>
    </Card>
  );
}
