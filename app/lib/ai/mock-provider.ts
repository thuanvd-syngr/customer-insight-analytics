import type { AIProvider, ContentGenerationInput, GeneratedContent, WeeklySummaryInput } from "./types";
import { buildRuleBasedContent } from "./content-generator";
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

  // Mock uses rule-based content so tests work without real AI credentials.
  async generateContent(input: ContentGenerationInput): Promise<GeneratedContent> {
    return buildRuleBasedContent(input);
  }
}
