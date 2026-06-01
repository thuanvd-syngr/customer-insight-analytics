import { Badge } from "@shopify/polaris";

export function MetricBadge({
  children,
  tone = "info",
}: {
  children: string;
  tone?: "info" | "success" | "warning" | "critical";
}) {
  return <Badge tone={tone}>{children}</Badge>;
}
