import { PriorityBadge, type PriorityLevel } from "./PriorityBadge";

export function SeverityBadge({ level }: { level: PriorityLevel }) {
  return <PriorityBadge level={level} withLabel />;
}
