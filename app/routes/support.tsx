export default function SupportPage() {
  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "40px 24px", fontFamily: "system-ui, sans-serif", color: "#111", lineHeight: 1.7 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Support</h1>
      <p style={{ color: "#6b7280", marginBottom: 32 }}>Customer Insight Analytics Support Center</p>

      <h2>Getting Started</h2>
      <ul>
        <li><strong>Import data</strong> — Go to <em>Import</em> to upload customer conversations or sync Shopify data.</li>
        <li><strong>Run analysis</strong> — Go to <em>Insights</em> and click <em>Run Analysis</em>.</li>
        <li><strong>Generate FAQs</strong> — Go to <em>FAQ</em> to generate and publish recovery content.</li>
        <li><strong>Track competitors</strong> — Add brand names in <em>Settings &rarr; Competitor Tracking</em>.</li>
      </ul>

      <h2>Common Questions</h2>

      <h3>Why are my analysis results empty?</h3>
      <p>Make sure you've imported at least 10 customer messages or synced your Shopify data before running analysis. Go to <em>Import</em> to add data.</p>

      <h3>How do I publish FAQ pages?</h3>
      <p>Go to <em>FAQ</em>, select opportunities to address, and click <em>Publish FAQ Page</em> or <em>Publish Blog Article</em>. Published content appears in <em>Publish</em>.</p>

      <h3>How does the Product FAQ Widget work?</h3>
      <p>Go to <em>Widget</em> for step-by-step instructions. The widget uses a Shopify Theme App Block that reads FAQ content from product metafields.</p>

      <h3>Why is my revenue estimate so high/low?</h3>
      <p>Revenue estimates are conservative projections based on industry benchmarks (average order value ×&nbsp;estimated conversion lift). They are directional, not guaranteed outcomes.</p>

      <h3>Can I use AI-generated content?</h3>
      <p>Set <code>AI_PROVIDER=groq</code> or <code>AI_PROVIDER=gemini</code> with the corresponding API key in your environment variables. The app falls back to rule-based generation if no AI provider is configured.</p>

      <h2>Contact Us</h2>
      <p>For technical issues, billing questions, or feature requests, use the <a href="/contact" style={{ color: "#6366f1" }}>Contact form</a>.</p>

      <h2>Useful Links</h2>
      <ul>
        <li><a href="/privacy" style={{ color: "#6366f1" }}>Privacy Policy</a></li>
        <li><a href="/terms" style={{ color: "#6366f1" }}>Terms of Service</a></li>
      </ul>
    </main>
  );
}
