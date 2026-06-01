import { BlockStack, Text } from "@shopify/polaris";

import { scoreTone, toneVar, type Tone } from "./format";

export interface ScoreGaugeProps {
  /** 0..100 */
  score: number;
  label?: string;
  size?: "small" | "large";
  /** Override the automatic tone (defaults to scoreTone). */
  tone?: Tone;
  /** Caption under the number, e.g. "Store health". */
  caption?: string;
}

// Semicircular SVG gauge. Pure, SSR-safe (no browser APIs).
const RADIUS = 50;
const ARC_LENGTH = Math.PI * RADIUS; // length of the 180° arc

/**
 * A semicircular health-score gauge rendered with inline SVG so it works in
 * the embedded admin without any chart dependency.
 */
export function ScoreGauge({
  score,
  label,
  size = "large",
  tone,
  caption,
}: ScoreGaugeProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(score || 0)));
  const fillTone = tone ?? scoreTone(clamped);
  const dash = (clamped / 100) * ARC_LENGTH;
  const dimension = size === "large" ? 180 : 120;
  const numberVariant = size === "large" ? "heading2xl" : "headingxl";

  return (
    <BlockStack gap="100" inlineAlign="center">
      <div style={{ width: dimension, maxWidth: "100%" }}>
        <svg viewBox="0 0 120 70" role="img" aria-label={`${clamped} out of 100`}>
          <path
            d="M10,62 A50,50 0 0 1 110,62"
            fill="none"
            stroke="var(--p-color-border, #e3e3e3)"
            strokeWidth="11"
            strokeLinecap="round"
          />
          <path
            d="M10,62 A50,50 0 0 1 110,62"
            fill="none"
            stroke={toneVar(fillTone)}
            strokeWidth="11"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${ARC_LENGTH}`}
          />
          <text
            x="60"
            y="58"
            textAnchor="middle"
            fontSize="26"
            fontWeight="700"
            fill="var(--p-color-text, #303030)"
          >
            {clamped}
          </text>
        </svg>
      </div>
      {label ? (
        <Text as="span" variant={numberVariant === "heading2xl" ? "headingSm" : "bodySm"} fontWeight="medium">
          {label}
        </Text>
      ) : null}
      {caption ? (
        <Text as="span" tone="subdued" variant="bodySm">
          {caption}
        </Text>
      ) : null}
    </BlockStack>
  );
}
