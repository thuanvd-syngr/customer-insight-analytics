import type { AIProvider, ContentGenerationInput, GeneratedContent, WeeklySummaryInput } from "./types";
import { buildContentPrompt, buildRuleBasedContent, parseAIContentResponse } from "./content-generator";
import { buildSummaryPrompt } from "./summary";

export class GroqProvider implements AIProvider {
  id = "groq" as const;
  label = "Groq";

  isConfigured(): boolean {
    return Boolean(process.env.GROQ_API_KEY);
  }

  private async chat(system: string, user: string): Promise<string> {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL ?? "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.3,
      }),
    });
    if (!res.ok) throw new Error(`Groq API failed: ${res.status}`);
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return body.choices?.[0]?.message?.content ?? "";
  }

  async generateWeeklySummary(input: WeeklySummaryInput): Promise<string> {
    const prompt = buildSummaryPrompt(input);
    return this.chat(prompt.system, prompt.user);
  }

  async generateContent(input: ContentGenerationInput): Promise<GeneratedContent> {
    try {
      const prompt = buildContentPrompt(input);
      const raw = await this.chat(prompt.system, prompt.user);
      const parsed = parseAIContentResponse(raw, input);
      if (parsed) return parsed;
    } catch {
      // fall through to rule-based
    }
    return buildRuleBasedContent(input);
  }
}
