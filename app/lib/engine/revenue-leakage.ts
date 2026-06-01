import type { KeywordGroupResult, RevenueLeakageAlert } from "~/lib/types";

import { KEYWORD_GROUPS_BY_ID, LEAKAGE_GROUP_IDS } from "./keyword-groups";

const severityRank = { high: 3, medium: 2, low: 1 } as const;

export function detectRevenueLeakage(
  groups: KeywordGroupResult[],
): RevenueLeakageAlert[] {
  return groups
    .filter(
      (group) =>
        LEAKAGE_GROUP_IDS.includes(group.groupId) &&
        group.trend7 >= 0.5 &&
        group.count >= 3,
    )
    .map((group) => {
      const severity =
        group.trend7 >= 2 || (group.trend7 >= 1 && group.count >= 10)
          ? "high"
          : group.trend7 >= 1
            ? "medium"
            : "low";
      return {
        groupId: group.groupId,
        label: KEYWORD_GROUPS_BY_ID[group.groupId].label,
        severity,
        count: group.count,
        trend7: group.trend7,
        message: `${group.label} friction is rising and may be costing sales.`,
      } satisfies RevenueLeakageAlert;
    })
    .sort(
      (a, b) =>
        severityRank[b.severity] - severityRank[a.severity] || b.trend7 - a.trend7,
    );
}
