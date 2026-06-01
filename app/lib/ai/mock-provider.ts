import type { AIProvider, WeeklySummaryInput } from "./types";
import { buildMockSummary } from "./summary";

export class MockProvider implements AIProvider {
  id = "mock" as const;
  label = "Mock";

  isConfigured(): boolean {
    return true;
  }

  async generateWeeklySummary(input: WeeklySummaryInput): Promise<string> {
    return buildMockSummary(input);
  }
}
