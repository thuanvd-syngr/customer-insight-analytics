// Email provider interface — provider-agnostic.
// MockEmailProvider logs to console + DB. Real providers (SendGrid, Postmark, Resend)
// implement the same interface — swap via EMAIL_PROVIDER env var.

export type EmailProviderId = "mock" | "sendgrid" | "postmark" | "resend";

export type EmailReportType =
  | "weekly"
  | "monthly"
  | "quarterly"
  | "alert_competitor"
  | "alert_high_impact"
  | "test";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

export interface EmailSendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  provider: EmailProviderId;
}

export interface EmailProvider {
  readonly id: EmailProviderId;
  isConfigured(): boolean;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export interface EmailLogEntry {
  shopId: string;
  reportType: EmailReportType;
  subject: string;
  recipientEmail: string;
  status: "pending" | "sent" | "failed" | "skipped";
  provider: EmailProviderId;
  error?: string;
}
