import type { AIProvider, AIProviderId, WeeklySummaryInput } from "./types";
import { GeminiProvider } from "./gemini-provider";
import { GroqProvider } from "./groq-provider";
import { MockProvider } from "./mock-provider";

class OffProvider implements AIProvider {
  id = "off" as const;
  label = "Off";

  isConfigured(): boolean {
    return false;
  }

  async generateWeeklySummary(_input: WeeklySummaryInput): Promise<string> {
    throw new Error("AI provider is off");
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

export type { AIProvider, AIProviderId, WeeklySummaryInput } from "./types";
export { MockProvider } from "./mock-provider";
export { buildMockSummary, buildSummaryPrompt } from "./summary";
