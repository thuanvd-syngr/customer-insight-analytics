import type { AIProvider, AIProviderId, ContentGenerationInput, GeneratedContent, WeeklySummaryInput } from "./types";
import { GeminiProvider } from "./gemini-provider";
import { GroqProvider } from "./groq-provider";
import { MockProvider } from "./mock-provider";
import { buildRuleBasedContent } from "./content-generator";

class OffProvider implements AIProvider {
  id = "off" as const;
  label = "Off";

  isConfigured(): boolean {
    return false;
  }

  async generateWeeklySummary(_input: WeeklySummaryInput): Promise<string> {
    throw new Error("AI provider is off");
  }

  async generateContent(input: ContentGenerationInput): Promise<GeneratedContent> {
    return buildRuleBasedContent(input);
  }
}

export function getAIProvider(providerId?: AIProviderId): AIProvider {
  const id = providerId ?? (process.env.AI_PROVIDER as AIProviderId | undefined) ?? "off";
  if (id === "mock") return new MockProvider();
  if (id === "groq") return new GroqProvider();
  if (id === "gemini") return new GeminiProvider();
  return new OffProvider();
}

export function isAIEnabled(): boolean {
  const provider = getAIProvider();
  return provider.id !== "off" && provider.isConfigured();
}

// Generates content using the configured AI provider, falling back to rule-based
// if AI is off or throws. This is the primary entry point for content generation.
export async function generateContentWithFallback(
  input: ContentGenerationInput,
): Promise<GeneratedContent> {
  const provider = getAIProvider();
  try {
    return await provider.generateContent(input);
  } catch {
    return buildRuleBasedContent(input);
  }
}

export type {
  AIProvider,
  AIProviderId,
  ContentGenerationInput,
  ContentType,
  FaqEntry,
  GeneratedContent,
  WeeklySummaryInput,
} from "./types";
export { CONTENT_TYPE_LABELS } from "./types";
export { MockProvider } from "./mock-provider";
export { buildMockSummary, buildSummaryPrompt } from "./summary";
export { buildRuleBasedContent, buildContentPrompt } from "./content-generator";
