export default function TermsPage() {
  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "40px 24px", fontFamily: "system-ui, sans-serif", color: "#111", lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Terms of Service</h1>
      <p style={{ color: "#6b7280", marginBottom: 32 }}>Last updated: June 2026</p>

      <h2>1. Acceptance</h2>
      <p>By installing Customer Insight Analytics from the Shopify App Store, you agree to these Terms of Service.</p>

      <h2>2. Service Description</h2>
      <p>Customer Insight Analytics analyzes your Shopify store data to identify revenue recovery opportunities, generate FAQ content, and produce performance reports.</p>

      <h2>3. Subscription and Billing</h2>
      <p>Paid plans are billed through Shopify's managed pricing system. Charges appear on your Shopify bill. You may cancel at any time from your Shopify admin. No refunds are issued for partial billing periods.</p>

      <h2>4. Acceptable Use</h2>
      <ul>
        <li>You may use generated content commercially without restriction.</li>
        <li>You may not attempt to reverse-engineer or scrape the analysis engine.</li>
        <li>You may not use the app to process data for stores you do not own or have explicit authorization to manage.</li>
      </ul>

      <h2>5. Limitation of Liability</h2>
      <p>Revenue recovery estimates are projections based on industry benchmarks and are not guarantees. We are not liable for business decisions made based on app recommendations.</p>

      <h2>6. Modifications</h2>
      <p>We reserve the right to modify these terms. Continued use after notice constitutes acceptance of changes.</p>

      <h2>7. Governing Law</h2>
      <p>These terms are governed by applicable law in the jurisdiction where we operate.</p>

      <h2>8. Contact</h2>
      <p>Questions? Visit our <a href="/support" style={{ color: "#6366f1" }}>Support page</a>.</p>
    </main>
  );
}
