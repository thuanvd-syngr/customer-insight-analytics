export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "40px 24px", fontFamily: "system-ui, sans-serif", color: "#111", lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Privacy Policy</h1>
      <p style={{ color: "#6b7280", marginBottom: 32 }}>Last updated: June 2026</p>

      <h2>1. Information We Collect</h2>
      <p>Customer Insight Analytics collects data that merchants grant access to via Shopify OAuth, including:</p>
      <ul>
        <li>Product catalog data (titles, descriptions, tags)</li>
        <li>Order notes and tags (not financial data or personal payment information)</li>
        <li>Customer notes and tags (not raw email addresses — hashed references only)</li>
        <li>App-generated insights, reports, and FAQ drafts</li>
      </ul>

      <h2>2. How We Use Your Data</h2>
      <p>Data is used exclusively to:</p>
      <ul>
        <li>Analyze customer friction and buying objections</li>
        <li>Generate FAQ content and recovery recommendations</li>
        <li>Produce revenue recovery reports for merchants</li>
      </ul>
      <p>We do not sell, share, or transfer your data to third parties for marketing purposes.</p>

      <h2>3. Data Retention</h2>
      <p>Analysis data is retained for the lifetime of your app installation. Upon uninstallation, all shop data is deleted within 48 hours per Shopify GDPR requirements.</p>

      <h2>4. GDPR Compliance</h2>
      <p>We comply with all Shopify Partner GDPR requirements including customer data request, customer data erasure, and shop data erasure webhooks.</p>

      <h2>5. Security</h2>
      <p>All data is stored in encrypted PostgreSQL databases. Access tokens are stored securely and rotated per Shopify standards. We do not log raw customer PII.</p>

      <h2>6. Contact</h2>
      <p>For privacy inquiries, contact us via the <a href="/support" style={{ color: "#6366f1" }}>Support page</a>.</p>
    </main>
  );
}
