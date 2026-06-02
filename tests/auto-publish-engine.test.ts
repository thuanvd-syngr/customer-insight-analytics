import { describe, expect, it } from "vitest";

import {
  evaluateAutoPublishRule,
  buildDefaultRules,
  parseConditions,
  serializeConditions,
  summarizeDecisions,
  RULE_TYPE_LABELS,
  TRIGGER_LABELS,
  type AutoPublishRuleInput,
  type AutoPublishDecision,
} from "~/lib/auto-publish-engine";
import { EMPTY_INSIGHT } from "~/lib/types";
import type { InsightResult } from "~/lib/types";

const MOCK_INSIGHT: InsightResult = {
  ...EMPTY_INSIGHT,
  insightScore: 65,
  messageCount: 100,
  storewideOpportunities: [
    {
      code: "STOREWIDE_SHIPPING_GAP",
      groupId: "shipping",
      label: "Shipping FAQ Gap",
      mentionCount: 20,
      priorityScore: 90,
      severity: "high",
      lowEstimate: 200,
      highEstimate: 500,
      suggestedAction: "Add shipping FAQ",
    },
    {
      code: "STOREWIDE_RETURN_GAP",
      groupId: "return",
      label: "Return Policy Gap",
      mentionCount: 8,
      priorityScore: 65,
      severity: "medium",
      lowEstimate: 80,
      highEstimate: 200,
      suggestedAction: "Add return FAQ",
    },
    {
      code: "STOREWIDE_PAYMENT_GAP",
      groupId: "payment",
      label: "Payment FAQ Gap",
      mentionCount: 4,
      priorityScore: 40,
      severity: "low",
      lowEstimate: 30,
      highEstimate: 80,
      suggestedAction: "Add payment FAQ",
    },
  ],
  questionOpportunities: [
    {
      groupId: "shipping",
      label: "Shipping Questions",
      count: 20,
      trend7: 0.4,
      severity: "high",
      revenueImpact: 300,
      lowEstimate: 200,
      highEstimate: 500,
      priorityScore: 90,
      actionType: "faq",
      suggestedAction: "Publish shipping FAQ",
    },
    {
      groupId: "warranty",
      label: "Warranty Questions",
      count: 12,
      trend7: 0.2,
      severity: "medium",
      revenueImpact: 150,
      lowEstimate: 100,
      highEstimate: 300,
      priorityScore: 70,
      actionType: "faq",
      suggestedAction: "Publish warranty FAQ",
    },
  ],
};

const ENABLED_FAQ_RULE: AutoPublishRuleInput = {
  ruleType: "faq",
  trigger: "on_insight",
  conditions: { minSeverity: "medium", maxPerRun: 3 },
  enabled: true,
};

const DISABLED_RULE: AutoPublishRuleInput = {
  ruleType: "faq",
  trigger: "on_insight",
  conditions: {},
  enabled: false,
};

const MANUAL_RULE: AutoPublishRuleInput = {
  ruleType: "blog",
  trigger: "manual",
  conditions: {},
  enabled: true,
};

// ─── parseConditions ─────────────────────────────────────────────────────────

describe("parseConditions", () => {
  it("parses valid JSON conditions", () => {
    const json = JSON.stringify({ minSeverity: "high", minMentions: 10, maxPerRun: 2 });
    const result = parseConditions(json);
    expect(result.minSeverity).toBe("high");
    expect(result.minMentions).toBe(10);
    expect(result.maxPerRun).toBe(2);
  });

  it("returns empty object for null", () => {
    expect(parseConditions(null)).toEqual({});
  });

  it("returns empty object for invalid JSON", () => {
    expect(parseConditions("not-json")).toEqual({});
  });

  it("parses groupIds as array", () => {
    const json = JSON.stringify({ groupIds: ["shipping", "return"] });
    const result = parseConditions(json);
    expect(result.groupIds).toEqual(["shipping", "return"]);
  });

  it("ignores non-array groupIds", () => {
    const json = JSON.stringify({ groupIds: "shipping" });
    const result = parseConditions(json);
    expect(result.groupIds).toBeUndefined();
  });
});

// ─── serializeConditions ─────────────────────────────────────────────────────

describe("serializeConditions", () => {
  it("roundtrips through JSON", () => {
    const conditions = { minSeverity: "high" as const, maxPerRun: 3 };
    const serialized = serializeConditions(conditions);
    const parsed = parseConditions(serialized);
    expect(parsed.minSeverity).toBe("high");
    expect(parsed.maxPerRun).toBe(3);
  });
});

// ─── evaluateAutoPublishRule — disabled ──────────────────────────────────────

describe("evaluateAutoPublishRule — disabled rule", () => {
  it("returns shouldPublish false", () => {
    const decision = evaluateAutoPublishRule(DISABLED_RULE, MOCK_INSIGHT);
    expect(decision.shouldPublish).toBe(false);
  });

  it("includes 'disabled' in reason", () => {
    const decision = evaluateAutoPublishRule(DISABLED_RULE, MOCK_INSIGHT);
    expect(decision.reason.toLowerCase()).toContain("disabled");
  });

  it("returns empty candidates", () => {
    const decision = evaluateAutoPublishRule(DISABLED_RULE, MOCK_INSIGHT);
    expect(decision.candidates).toHaveLength(0);
  });
});

// ─── evaluateAutoPublishRule — manual trigger ─────────────────────────────────

describe("evaluateAutoPublishRule — manual trigger", () => {
  it("returns shouldPublish false", () => {
    const decision = evaluateAutoPublishRule(MANUAL_RULE, MOCK_INSIGHT);
    expect(decision.shouldPublish).toBe(false);
  });

  it("reason mentions manual", () => {
    const decision = evaluateAutoPublishRule(MANUAL_RULE, MOCK_INSIGHT);
    expect(decision.reason.toLowerCase()).toContain("manual");
  });
});

// ─── evaluateAutoPublishRule — faq rule ──────────────────────────────────────

describe("evaluateAutoPublishRule — FAQ rule with candidates", () => {
  it("returns shouldPublish true when candidates exist", () => {
    const decision = evaluateAutoPublishRule(ENABLED_FAQ_RULE, MOCK_INSIGHT);
    expect(decision.shouldPublish).toBe(true);
  });

  it("candidates are filtered by minSeverity medium", () => {
    const decision = evaluateAutoPublishRule(ENABLED_FAQ_RULE, MOCK_INSIGHT);
    // medium and high should be included
    expect(decision.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it("cappedCount does not exceed maxPerRun", () => {
    const decision = evaluateAutoPublishRule(ENABLED_FAQ_RULE, MOCK_INSIGHT);
    expect(decision.cappedCount).toBeLessThanOrEqual(3);
  });

  it("candidates are sorted by priority descending", () => {
    const decision = evaluateAutoPublishRule(ENABLED_FAQ_RULE, MOCK_INSIGHT);
    if (decision.candidates.length > 1) {
      expect(decision.candidates[0].priority).toBeGreaterThanOrEqual(decision.candidates[1].priority);
    }
  });

  it("returns no candidates for high-only rule with only low opportunities", () => {
    const highOnly: AutoPublishRuleInput = {
      ruleType: "faq",
      trigger: "on_insight",
      conditions: { minSeverity: "high", groupIds: ["payment"] },
      enabled: true,
    };
    // payment is "low" severity → should not qualify
    const decision = evaluateAutoPublishRule(highOnly, MOCK_INSIGHT);
    expect(decision.shouldPublish).toBe(false);
  });
});

// ─── evaluateAutoPublishRule — groupIds filter ────────────────────────────────

describe("evaluateAutoPublishRule — groupIds filter", () => {
  it("filters to specified groupIds only", () => {
    const rule: AutoPublishRuleInput = {
      ruleType: "faq",
      trigger: "on_insight",
      conditions: { groupIds: ["shipping"] },
      enabled: true,
    };
    const decision = evaluateAutoPublishRule(rule, MOCK_INSIGHT);
    expect(decision.candidates.every((c) => c.groupId === "shipping")).toBe(true);
  });
});

// ─── evaluateAutoPublishRule — page rule ─────────────────────────────────────

describe("evaluateAutoPublishRule — page rule", () => {
  it("builds page candidates from page groups", () => {
    const rule: AutoPublishRuleInput = {
      ruleType: "page",
      trigger: "on_insight",
      conditions: { minSeverity: "low" },
      enabled: true,
    };
    const decision = evaluateAutoPublishRule(rule, MOCK_INSIGHT);
    // shipping, return, payment are all page groups
    expect(decision.candidates.length).toBeGreaterThan(0);
  });
});

// ─── evaluateAutoPublishRule — empty insight ──────────────────────────────────

describe("evaluateAutoPublishRule — empty insight", () => {
  it("returns no candidates for empty insight", () => {
    const decision = evaluateAutoPublishRule(ENABLED_FAQ_RULE, EMPTY_INSIGHT);
    expect(decision.shouldPublish).toBe(false);
    expect(decision.candidates).toHaveLength(0);
  });
});

// ─── buildDefaultRules ────────────────────────────────────────────────────────

describe("buildDefaultRules", () => {
  it("returns 3 default rules", () => {
    expect(buildDefaultRules()).toHaveLength(3);
  });

  it("all default rules are disabled", () => {
    for (const rule of buildDefaultRules()) {
      expect(rule.enabled).toBe(false);
    }
  });

  it("covers faq, blog, page types", () => {
    const types = buildDefaultRules().map((r) => r.ruleType);
    expect(types).toContain("faq");
    expect(types).toContain("blog");
    expect(types).toContain("page");
  });
});

// ─── summarizeDecisions ───────────────────────────────────────────────────────

describe("summarizeDecisions", () => {
  it("counts total would-publish", () => {
    const decisions: AutoPublishDecision[] = [
      {
        ruleType: "faq",
        trigger: "on_insight",
        shouldPublish: true,
        reason: "ok",
        candidates: [{ id: "a", label: "A", estimatedLow: 0, estimatedHigh: 0, priority: 80 }],
        cappedCount: 1,
      },
      {
        ruleType: "blog",
        trigger: "on_insight",
        shouldPublish: false,
        reason: "Rule is disabled.",
        candidates: [],
        cappedCount: 0,
      },
    ];
    const summary = summarizeDecisions(decisions);
    expect(summary.totalWouldPublish).toBe(1);
    expect(summary.disabledRules).toBe(1);
  });
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe("RULE_TYPE_LABELS", () => {
  it("has labels for all rule types", () => {
    expect(RULE_TYPE_LABELS.faq).toBeTruthy();
    expect(RULE_TYPE_LABELS.blog).toBeTruthy();
    expect(RULE_TYPE_LABELS.page).toBeTruthy();
  });
});

describe("TRIGGER_LABELS", () => {
  it("has labels for all triggers", () => {
    expect(TRIGGER_LABELS.on_insight).toBeTruthy();
    expect(TRIGGER_LABELS.on_threshold).toBeTruthy();
    expect(TRIGGER_LABELS.manual).toBeTruthy();
  });
});
