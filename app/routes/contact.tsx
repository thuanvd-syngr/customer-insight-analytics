import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData } from "@remix-run/react";

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim();
  const message = String(form.get("message") ?? "").trim();
  if (!email || !message) {
    return json({ error: "Email and message are required." });
  }
  // In production: forward to support ticket system.
  // For now: log and acknowledge.
  console.log(`[contact] From: ${email}\n${message}`);
  return json({ success: true });
}

export default function ContactPage() {
  const actionData = useActionData<typeof action>();

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    fontFamily: "inherit",
    fontSize: 14,
    boxSizing: "border-box" as const,
  };

  return (
    <main style={{ maxWidth: 600, margin: "0 auto", padding: "40px 24px", fontFamily: "system-ui, sans-serif", color: "#111", lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Contact Us</h1>
      <p style={{ color: "#6b7280", marginBottom: 32 }}>
        Send us a message and we'll respond within 1–2 business days.
        For immediate help, see the <a href="/support" style={{ color: "#6366f1" }}>Support page</a>.
      </p>

      {actionData && "success" in actionData ? (
        <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "16px 20px", marginBottom: 24 }}>
          <p style={{ margin: 0, color: "#15803d", fontWeight: 500 }}>Message received! We'll get back to you within 1–2 business days.</p>
        </div>
      ) : (
        <Form method="post">
          <div style={{ marginBottom: 16 }}>
            {actionData && "error" in actionData ? (
              <p style={{ color: "#dc2626", marginBottom: 8 }}>{actionData.error}</p>
            ) : null}
            <label htmlFor="contact-email" style={{ display: "block", marginBottom: 6, fontSize: 14, fontWeight: 500 }}>
              Your email address
            </label>
            <input id="contact-email" name="email" type="email" required placeholder="you@example.com" style={inputStyle} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label htmlFor="contact-store" style={{ display: "block", marginBottom: 6, fontSize: 14, fontWeight: 500 }}>
              Shopify store domain (optional)
            </label>
            <input id="contact-store" name="store" type="text" placeholder="your-store.myshopify.com" style={inputStyle} />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label htmlFor="contact-message" style={{ display: "block", marginBottom: 6, fontSize: 14, fontWeight: 500 }}>
              Message
            </label>
            <textarea
              id="contact-message"
              name="message"
              required
              rows={6}
              placeholder="Describe your issue or question…"
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </div>

          <button
            type="submit"
            style={{
              background: "#6366f1",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "12px 24px",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Send message
          </button>
        </Form>
      )}
    </main>
  );
}
