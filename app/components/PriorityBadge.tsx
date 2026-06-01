import { Badge } from "@shopify/polaris";

export type PriorityLevel = "low" | "medium" | "high";

export interface PriorityBadgeProps {
  level: PriorityLevel;
  /** Append the word "priority" to the label. */
  withLabel?: boolean;
}

const TONE: Record<PriorityLevel, "info" | "warning" | "critical"> = {
  low: "info",
  medium: "warning",
  high: "critical",
};

const LABEL: Record<PriorityLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

/** A consistent priority/severity badge used across insights and products. */
export function PriorityBadge({ level, withLabel }: PriorityBadgeProps) {
  return (
    <Badge tone={TONE[level]}>
      {withLabel ? `${LABEL[level]} priority` : LABEL[level]}
    </Badge>
  );
}
