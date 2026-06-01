import { BlockStack, InlineStack, Text } from "@shopify/polaris";

import { toneVar, type Tone } from "./format";

export interface TrendChartPoint {
  date: string;
  count: number;
}

export interface TrendChartProps {
  points: TrendChartPoint[];
  tone?: Tone;
  /** SVG pixel height of the plot area. */
  height?: number;
  /** Show first/last date labels under the chart. */
  showAxis?: boolean;
}

const W = 100; // viewBox width units
const PAD = 4;

/**
 * A lightweight area/line trend chart drawn with inline SVG (no chart lib).
 * Scales to its container width. Used for weekly volume and drill-down timelines.
 */
export function TrendChart({
  points,
  tone = "info",
  height = 56,
  showAxis = true,
}: TrendChartProps) {
  const data = points ?? [];

  if (data.length === 0) {
    return (
      <Text as="p" tone="subdued" variant="bodySm">
        Run analysis to see trend movement.
      </Text>
    );
  }

  const max = Math.max(1, ...data.map((p) => p.count || 0));
  const h = height;
  const plotH = h - PAD * 2;
  const n = data.length;

  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * (W - PAD * 2) + PAD);
  const y = (count: number) => PAD + (plotH - (Math.max(0, count) / max) * plotH);

  const linePoints = data.map((p, i) => `${x(i)},${y(p.count)}`).join(" ");
  const areaPath =
    `M ${x(0)},${h - PAD} ` +
    data.map((p, i) => `L ${x(i)},${y(p.count)}`).join(" ") +
    ` L ${x(n - 1)},${h - PAD} Z`;
  const color = toneVar(tone);

  return (
    <BlockStack gap="100">
      <div style={{ width: "100%" }}>
        <svg
          viewBox={`0 0 ${W} ${h}`}
          preserveAspectRatio="none"
          width="100%"
          height={h}
          role="img"
          aria-label="Trend over time"
        >
          <path d={areaPath} fill={color} opacity="0.14" />
          <polyline
            points={linePoints}
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {data.map((p, i) => (
            <circle key={p.date} cx={x(i)} cy={y(p.count)} r="1.4" fill={color} />
          ))}
        </svg>
      </div>
      {showAxis ? (
        <InlineStack align="space-between">
          <Text as="span" variant="bodySm" tone="subdued">
            {data[0]?.date}
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            {data[n - 1]?.date}
          </Text>
        </InlineStack>
      ) : null}
    </BlockStack>
  );
}
