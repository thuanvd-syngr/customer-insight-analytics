import type { AIProvider, WeeklySummaryInput } from "./types";
import { buildSummaryPrompt } from "./summary";

export class GroqProvider implements AIProvider {
  id = "groq" as const;
  label = "Groq";

  isConfigured(): boolean {
    return Boolean(process.env.GROQ_API_KEY);
  }

  async generateWeeklySummary(input: WeeklySummaryInput): Promise<string> {
    const prompt = buildSummaryPrompt(input);
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL ?? "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user },
        ],
        temperature: 0.2,
      }),
    });
    if (!res.ok) throw new Error(`Groq summary failed: ${res.status}`);
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return body.choices?.[0]?.message?.content ?? "";
  }
}
