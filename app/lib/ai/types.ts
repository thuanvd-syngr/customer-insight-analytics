import type { InsightResult } from "~/lib/types";

export type AIProviderId = "off" | "mock" | "groq" | "gemini";

export interface WeeklySummaryInput {
  shopDomain: string;
  insight: InsightResult;
  weekStart: string;
  weekEnd: string;
}

export interface AIProvider {
  id: AIProviderId;
  label: string;
  isConfigured(): boolean;
  generateWeeklySummary(input: WeeklySummaryInput): Promise<string>;
}
