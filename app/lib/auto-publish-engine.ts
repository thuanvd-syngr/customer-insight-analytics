// Auto-Publish Engine — rule evaluation and candidate selection. Pure functions, no DB.
// Routes call evaluateAutoPublishRule() with insight data to decide what to publish.

import type { InsightResult, LeakageSeverity, StorewideOpportunity } from "~/lib/types";

export type AutoPublishRuleType = "faq" | "blog" | "page";
export type AutoPublishTrigger = "on_insight" | "on_threshold" | "manual";

export interface AutoPublishConditions {
  minSeverity?: LeakageSeverity;
  minMentions?: number;
  groupIds?: string[];
  maxPerRun?: number;
}

export interface PublishCandidate {
  id: string;
  label: string;
  groupId?: string;
  estimatedLow: number;
  estimatedHigh: number;
  priority: number; // 0-100
}

export interface AutoPublishDecision {
  ruleType: AutoPublishRuleType;
  trigger: AutoPublishTrigger;
  shouldPublish: boolean;
  reason: string;
  candidates: PublishCandidate[];
  cappedCount: number; // how many would be published after maxPerRun cap
}

export interface AutoPublishRuleInput {
  ruleType: AutoPublishRuleType;
  trigger: AutoPublishTrigger;
  conditions: AutoPublishConditions;
  enabled: boolean;
}

export const RULE_TYPE_LABELS: Record<AutoPublishRuleType, string> = {
  faq: "FAQ Pages",
  blog: "Blog Articles",
  page: "Store Pages",
};

export const TRIGGER_LABELS: Record<AutoPublishTrigger, string> = {
  on_insight: "After Each Analysis Run",
  on_threshold: "When Severity Threshold Met",
  manual: "Manual Trigger Only",
};

const SEVERITY_RANK: Record<LeakageSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export function parseConditions(json: string | null | undefined): AutoPublishConditions {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return {};
    return {
      minSeverity: parsed.minSeverity,
      minMentions: typeof parsed.minMentions === "number" ? parsed.minMentions : undefined,
      groupIds: Array.isArray(parsed.groupIds) ? parsed.groupIds : undefined,
      maxPerRun: typeof parsed.maxPerRun === "number" ? parsed.maxPerRun : undefined,
    };
  } catch {
    return {};
  }
}

export function serializeConditions(conditions: AutoPublishConditions): string {
  return JSON.stringify(conditions);
}

function meetsSeverityCondition(
  severity: LeakageSeverity,
  minSeverity?: LeakageSeverity,
): boolean {
  if (!minSeverity) return true;
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[minSeverity];
}

function meetsGroupCondition(groupId: string, groupIds?: string[]): boolean {
  if (!groupIds || groupIds.length === 0) return true;
  return groupIds.includes(groupId);
}

function buildFaqCandidates(
  insight: InsightResult,
  conditions: AutoPublishConditions,
): PublishCandidate[] {
  return insight.storewideOpportunities
    .filter(
      (o) =>
        meetsSeverityCondition(o.severity, conditions.minSeverity) &&
        meetsGroupCondition(o.groupId, conditions.groupIds) &&
        (conditions.minMentions === undefined || o.mentionCount >= conditions.minMentions),
    )
    .map((o) => ({
      id: o.groupId,
      label: o.label,
      groupId: o.groupId,
      estimatedLow: o.lowEstimate,
      estimatedHigh: o.highEstimate,
      priority: o.priorityScore,
    }))
    .sort((a, b) => b.priority - a.priority);
}

function buildBlogCandidates(
  insight: InsightResult,
  conditions: AutoPublishConditions,
): PublishCandidate[] {
  return insight.questionOpportunities
    .filter(
      (o) =>
        meetsSeverityCondition(o.severity, conditions.minSeverity) &&
        meetsGroupCondition(o.groupId, conditions.groupIds) &&
        (conditions.minMentions === undefined || o.count >= conditions.minMentions),
    )
    .map((o) => ({
      id: o.groupId,
      label: o.label,
      groupId: o.groupId,
      estimatedLow: o.lowEstimate,
      estimatedHigh: o.highEstimate,
      priority: o.priorityScore,
    }))
    .sort((a, b) => b.priority - a.priority);
}

function buildPageCandidates(
  insight: InsightResult,
  conditions: AutoPublishConditions,
): PublishCandidate[] {
  const pageGroupIds = ["shipping", "return", "warranty", "payment", "discount"];
  return insight.storewideOpportunities
    .filter(
      (o) =>
        pageGroupIds.includes(o.groupId) &&
        meetsSeverityCondition(o.severity, conditions.minSeverity) &&
        meetsGroupCondition(o.groupId, conditions.groupIds) &&
        (conditions.minMentions === undefined || o.mentionCount >= conditions.minMentions),
    )
    .map((o) => ({
      id: o.groupId,
      label: `${o.label} Policy Page`,
      groupId: o.groupId,
      estimatedLow: o.lowEstimate,
      estimatedHigh: o.highEstimate,
      priority: o.priorityScore,
    }))
    .sort((a, b) => b.priority - a.priority);
}

export function evaluateAutoPublishRule(
  rule: AutoPublishRuleInput,
  insight: InsightResult,
): AutoPublishDecision {
  if (!rule.enabled) {
    return {
      ruleType: rule.ruleType,
      trigger: rule.trigger,
      shouldPublish: false,
      reason: "Rule is disabled.",
      candidates: [],
      cappedCount: 0,
    };
  }

  if (rule.trigger === "manual") {
    return {
      ruleType: rule.ruleType,
      trigger: rule.trigger,
      shouldPublish: false,
      reason: "Manual trigger — no automatic publishing.",
      candidates: [],
      cappedCount: 0,
    };
  }

  let candidates: PublishCandidate[];
  if (rule.ruleType === "faq") {
    candidates = buildFaqCandidates(insight, rule.conditions);
  } else if (rule.ruleType === "blog") {
    candidates = buildBlogCandidates(insight, rule.conditions);
  } else {
    candidates = buildPageCandidates(insight, rule.conditions);
  }

  if (candidates.length === 0) {
    return {
      ruleType: rule.ruleType,
      trigger: rule.trigger,
      shouldPublish: false,
      reason: "No candidates meet the configured conditions.",
      candidates: [],
      cappedCount: 0,
    };
  }

  const max = rule.conditions.maxPerRun ?? 5;
  const cappedCount = Math.min(candidates.length, max);

  return {
    ruleType: rule.ruleType,
    trigger: rule.trigger,
    shouldPublish: true,
    reason: `${candidates.length} candidate${candidates.length > 1 ? "s" : ""} found — ${cappedCount} will be published (maxPerRun: ${max}).`,
    candidates,
    cappedCount,
  };
}

export function buildDefaultRules(): AutoPublishRuleInput[] {
  return [
    {
      ruleType: "faq",
      trigger: "on_insight",
      conditions: { minSeverity: "high", maxPerRun: 3 },
      enabled: false,
    },
    {
      ruleType: "blog",
      trigger: "on_threshold",
      conditions: { minMentions: 10, maxPerRun: 2 },
      enabled: false,
    },
    {
      ruleType: "page",
      trigger: "on_insight",
      conditions: { minSeverity: "medium", groupIds: ["shipping", "return"], maxPerRun: 2 },
      enabled: false,
    },
  ];
}

export function summarizeDecisions(decisions: AutoPublishDecision[]): {
  totalWouldPublish: number;
  enabledRules: number;
  disabledRules: number;
  rulesSummary: Array<{ ruleType: AutoPublishRuleType; candidateCount: number; willPublish: boolean }>;
} {
  return {
    totalWouldPublish: decisions.filter((d) => d.shouldPublish).reduce((s, d) => s + d.cappedCount, 0),
    enabledRules: decisions.filter((d) => d.shouldPublish || d.reason !== "Rule is disabled.").length,
    disabledRules: decisions.filter((d) => d.reason === "Rule is disabled.").length,
    rulesSummary: decisions.map((d) => ({
      ruleType: d.ruleType,
      candidateCount: d.candidates.length,
      willPublish: d.shouldPublish,
    })),
  };
}
