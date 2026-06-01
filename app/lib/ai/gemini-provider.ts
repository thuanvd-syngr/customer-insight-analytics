import type { AIProvider, WeeklySummaryInput } from "./types";
import { buildSummaryPrompt } from "./summary";

export class GeminiProvider implements AIProvider {
  id = "gemini" as const;
  label = "Gemini";

  isConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY);
  }

  async generateWeeklySummary(input: WeeklySummaryInput): Promise<string> {
    const prompt = buildSummaryPrompt(input);
    const model = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${prompt.system}\n\n${prompt.user}` }] }],
          generationConfig: { temperature: 0.2 },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini summary failed: ${res.status}`);
    const body = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }
}
