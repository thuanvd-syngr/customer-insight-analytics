# Shopify App Store Reviewer Instructions — Customer Insight Analytics

**App URL:** https://customer-insight-analytics-ww7zt533aa-as.a.run.app  
**Shopify API Version:** 2026-01  
**Review Scope:** Embedded app — no storefront scripts, no theme injection

---

## What This App Does

Customer Insight Analytics helps merchants find and fix buying objections that prevent shoppers from completing a purchase. The workflow is four steps:

1. **Import conversations** — Merchant uploads CSV exports from Helpdesk, email, or live chat; the app also reads order notes directly from Shopify.
2. **Analyze buying questions** — A keyword engine groups questions into objection categories: shipping, returns, payment, sizing, stock, discounts, warranty, competitor comparisons.
3. **Generate recovery content** — The app drafts FAQ answers and content page templates for the highest-impact objections.
4. **Publish to store** — One click publishes FAQ pages, blog articles, and product FAQ blocks directly to the merchant's Shopify storefront via the Admin API.

The app does **not** inject scripts into storefronts, does **not** modify product prices, and does **not** access payment card information.

---

## Installing and Testing

### Recommended test path

1. Install the app from the development store link provided in the Partner Dashboard submission.
2. The app opens to the **Revenue Recovery Onboarding** wizard.
3. Click **Sync product and order data** in Step 1. The app reads products and order notes from your Shopify store. On a fresh dev store with no orders this will show "0 orders found" — that is expected behaviour.
4. Navigate to **Import** in the sidebar (or follow Step 1 "Review" button). Use the built-in **sample data** option to populate test questions without a real CSV file. This pre-loads 20 synthetic customer questions covering shipping, returns, and payment topics.
5. Click **Run Analysis** from the dashboard or Step 2. Analysis completes in under 10 seconds.
6. Navigate to **Recovery Plan** to view detected objection categories and revenue estimates.
7. Navigate to **Content** → click **Generate FAQ** to generate a draft FAQ answer for any category.
8. Navigate to **Publish** to see the publish diagnostics and available content. Click **Publish page** next to any content type to create a Shopify page.
9. Navigate to **Theme Audit** — the scanner reviews your product content and surfaces missing FAQ sections and warranty information.
10. Navigate to **Products** — each product shows its description status and content gap score.

### Demo mode note

The app includes a demo mode (`?demo=1` on any page) that populates all views with static sample data. This mode makes no database writes and no Shopify API calls. Use it to preview every screen without importing real data.

---

## Permissions Used (Scope Justification)

| Scope | Where It Is Used | Why It Is Required |
|---|---|---|
| `read_products` | Import > Sync, Products page, Theme Audit | Fetches product titles, descriptions, tags, collections, and handles. Used to build the objection analysis dataset and detect content gaps on product pages. |
| `write_products` | FAQ page → "Publish product FAQ" intent | Writes FAQ content as a product metafield (`custom.faq`) so the merchant's theme can display it inline on the product detail page. |
| `read_orders` | Import > Sync (order notes), dashboard auto-sync | Reads order `note` and `tags` fields only. These often contain merchant-observed customer questions ("customer asked about return policy before buying"). No customer PII (name, email, address, payment) is fetched. |
| `read_content` | Publish page diagnostics, Theme Audit scan | Reads existing Shopify Pages and Blog Articles to detect which FAQ and policy content already exists and avoid duplicate publishing. |
| `write_content` | Publish page → "Publish page" and "Publish blog" intents | Creates Shopify Pages (FAQ, shipping, returns, warranty) and Blog Articles in the merchant's existing Online Store blog. This is the core value delivery of the app. |

**Note on Shopify implied scopes:** Shopify OAuth grants `write_products` and `write_content` without repeating `read_products` and `read_content` in the token string, because write access implies read access. The app correctly handles this — no false reauthorize prompts are triggered.

---

## Data Privacy and GDPR

### What is stored in the app database

| Data type | Source | Stored fields | PII? |
|---|---|---|---|
| Product metadata | `read_products` GraphQL | id, title, handle, vendor, description, tags, productType, collections | No |
| Order signals | `read_orders` GraphQL | order note text, order tags | Potentially (merchant-entered text; no customer name/email/address fetched) |
| Customer questions | Merchant CSV upload | Message text, source label, optional external ID | Depends on merchant upload |
| Analysis results | Computed by app | Objection category scores, revenue estimates | No |
| Published content | App-generated | FAQ text, page/article Shopify GIDs | No |

Customer PII (email, name, phone, address, payment) is **never fetched** from Shopify, never stored, and never transmitted to third parties.

### Data retention and deletion

| Trigger | Action |
|---|---|
| Merchant uninstalls app | `app/uninstalled` webhook fires. All shop-scoped rows deleted within 30 days (cascade delete on `Shop` table). |
| `shop/redact` webhook | Permanent deletion of all records for the shop. Fires after 48-hour grace period post-uninstall. |
| `customers/redact` webhook | No customer PII is stored. Handler logs the request; no records to delete. Response: HTTP 200. |
| `customers/data_request` webhook | No customer-identifiable data is held. Handler responds with an empty subject list. Response: HTTP 200. |

### GDPR webhook status

The three compliance webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) are registered in the **development config** (`shopify.app.toml`) and are tested. In the current production config (`shopify.app.production.toml`) the subscriptions are commented out pending Shopify's approval of the **Protected Customer Data** declaration in the Partner Dashboard. The route handlers are active and deployed; they will process requests immediately once the subscriptions are re-enabled post-approval.

---

## Billing Plans

| Plan | Price | Monthly message limit | Key features |
|---|---|---|---|
| Free | $0 | 100 | Weekly analysis, theme audit, basic dashboard |
| Starter | $29/month | 1,000 | Daily analysis, revenue opportunity scores, content gap detection |
| Growth | $49/month | 10,000 | FAQ publishing to Shopify, weekly email reports, competitor tracking |
| Pro | $79/month | 50,000 | Bulk publishing, priority processing, executive reports |

All paid plans include a 7-day free trial. Billing is managed entirely through Shopify's managed pricing; no credit card data passes through the app.

**For testing billing:** `SHOPIFY_BILLING_TEST=true` is set in the production environment, which means all charge authorizations go through Shopify's test billing flow (no real charges). This flag must be set to `false` before going live with real merchant charges.

---

## Known Limitations in the Current Review Build

1. **Protected Customer Data approval pending.** GDPR compliance webhooks are not yet active in production. Shopify reviewer testing can verify the handler routes directly at `/webhooks/customers/data_request`, `/webhooks/customers/redact`, and `/webhooks/shop/redact` — all respond correctly. Subscriptions will be re-enabled once Shopify approves the data declaration.

2. **Zero orders on a fresh dev store.** The app gracefully shows "No orders found in this dev store" and continues to work for product-based analysis. No errors are thrown.

3. **AI summaries require an external API key.** The app runs fully without AI (`AI_PROVIDER=mock` is the default). Weekly AI summaries are only available on Growth/Pro plans and require a Groq or Gemini API key configured in environment variables. The review build uses the mock provider — all summary text is static.

---

## Webhooks

| Topic | Endpoint | Purpose |
|---|---|---|
| `app/uninstalled` | `/webhooks/app/uninstalled` | Triggers shop data cleanup |
| `app/scopes_update` | `/webhooks/app/scopes_update` | Detects scope changes, prompts reauthorize if required scopes are lost |
| `products/create` | `/webhooks/products/create` | Syncs new products into the app database |
| `products/update` | `/webhooks/products/update` | Updates cached product metadata |
| `orders/create` | `/webhooks/orders/create` | Ingests new order notes for analysis |
| `customers/data_request` *(pending approval)* | `/webhooks/customers/data_request` | GDPR: responds that no customer-identifiable data is held |
| `customers/redact` *(pending approval)* | `/webhooks/customers/redact` | GDPR: no-op (no PII stored) |
| `shop/redact` *(pending approval)* | `/webhooks/shop/redact` | GDPR: permanent deletion of all shop data |

---

## Support Information

- **Support page:** `[app-url]/support`
- **Privacy policy:** `[app-url]/privacy`
- **Terms of service:** `[app-url]/terms`

All three routes are publicly accessible without authentication.
