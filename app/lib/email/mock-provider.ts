import type { EmailMessage, EmailProvider, EmailSendResult } from "./types";

// Mock email provider — logs to console, never sends real email.
// Used in test mode, development, and when no provider is configured.
export class MockEmailProvider implements EmailProvider {
  readonly id = "mock" as const;

  isConfigured(): boolean {
    return true; // Always available as fallback
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const fakeMessageId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[MockEmail] To: ${message.to} | Subject: ${message.subject} | id: ${fakeMessageId}`);
    return { ok: true, messageId: fakeMessageId, provider: "mock" };
  }
}
