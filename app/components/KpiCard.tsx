import { BlockStack, Text } from "@shopify/polaris";
import type { ReactNode } from "react";

import type { Tone } from "./format";
import { textTone } from "./format";

export function KpiCard({
  label,
  value,
  detail,
  tone = "info",
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  tone?: Tone;
}) {
  return (
    <div className="cia-card cia-card-pad">
      <BlockStack gap="150">
        <Text as="p" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <div className={`cia-kpi-value cia-kpi-${textTone(tone)}`}>{value}</div>
        {detail ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {detail}
          </Text>
        ) : null}
      </BlockStack>
    </div>
  );
}
