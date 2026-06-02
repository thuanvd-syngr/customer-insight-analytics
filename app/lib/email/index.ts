// Email provider factory + DB logging helper.
// getEmailProvider() is server-only (reads env vars).
// Types and builders are client-safe.

import type { PrismaClient } from "@prisma/client";
import { getDelegate } from "~/lib/prisma-safe";
import { MockEmailProvider } from "./mock-provider";
import type { EmailMessage, EmailProvider, EmailLogEntry } from "./types";

export * from "./types";
export * from "./report-email";

/**
 * Returns the configured email provider based on EMAIL_PROVIDER env var.
 * Falls back to MockEmailProvider — always available.
 */
export function getEmailProvider(): EmailProvider {
  const id = process.env.EMAIL_PROVIDER ?? "mock";
  // Future: if (id === "sendgrid") return new SendGridProvider(process.env.SENDGRID_API_KEY ?? "");
  // Future: if (id === "postmark") return new PostmarkProvider(process.env.POSTMARK_API_KEY ?? "");
  // Future: if (id === "resend") return new ResendProvider(process.env.RESEND_API_KEY ?? "");
  if (id !== "mock") {
    console.warn(`[Email] Unknown provider "${id}", falling back to mock.`);
  }
  return new MockEmailProvider();
}

/**
 * Send an email and log the attempt to EmailReportLog.
 * Never throws — returns { ok: false, error } on failure.
 */
export async function sendAndLog(
  db: PrismaClient,
  entry: EmailLogEntry,
  message: EmailMessage,
): Promise<{ ok: boolean; error?: string }> {
  const provider = getEmailProvider();
  const logModel = getDelegate(db, "emailReportLog");

  try {
    const result = await provider.send(message);
    if (logModel?.create) {
      await logModel.create({
        data: {
          shopId: entry.shopId,
          reportType: entry.reportType,
          subject: message.subject,
          recipientEmail: message.to,
          status: result.ok ? "sent" : "failed",
          provider: provider.id,
          error: result.error ?? null,
          sentAt: result.ok ? new Date() : null,
        },
      });
    }
    return { ok: result.ok, error: result.error };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Send failed";
    if (logModel?.create) {
      await logModel.create({
        data: {
          shopId: entry.shopId,
          reportType: entry.reportType,
          subject: message.subject,
          recipientEmail: message.to,
          status: "failed",
          provider: provider.id,
          error,
        },
      });
    }
    return { ok: false, error };
  }
}
