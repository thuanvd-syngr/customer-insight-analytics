import type { AIProvider, ContentGenerationInput, GeneratedContent, WeeklySummaryInput } from "./types";
import { buildContentPrompt, buildRuleBasedContent, parseAIContentResponse } from "./content-generator";
import { buildSummaryPrompt } from "./summary";

export class GeminiProvider implements AIProvider {
  id = "gemini" as const;
  label = "Gemini";

  isConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY);
  }

  private async generate(text: string): Promise<string> {
    const model = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: { temperature: 0.3 },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini API failed: ${res.status}`);
    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }

  async generateWeeklySummary(input: WeeklySummaryInput): Promise<string> {
    const prompt = buildSummaryPrompt(input);
    return this.generate(`${prompt.system}\n\n${prompt.user}`);
  }

  async generateContent(input: ContentGenerationInput): Promise<GeneratedContent> {
    try {
      const prompt = buildContentPrompt(input);
      const raw = await this.generate(`${prompt.system}\n\n${prompt.user}`);
      const parsed = parseAIContentResponse(raw, input);
      if (parsed) return parsed;
    } catch {
      // fall through to rule-based
    }
    return buildRuleBasedContent(input);
  }
}
