# Shopify App Store Review Checklist — Customer Insight Analytics

> Detailed reviewer instructions (scope justifications, test walkthrough, data privacy, billing) are in [REVIEWER_INSTRUCTIONS.md](./REVIEWER_INSTRUCTIONS.md).

## 1. Protected Customer Data (REQUIRED before final deploy)

The production config (`shopify.app.production.toml`) has GDPR compliance webhook
subscriptions commented out until this approval is granted.

**Steps:**
1. Log in to [Shopify Partner Dashboard](https://partners.shopify.com)
2. Navigate to **Apps → Customer Insight Analytics → App setup**
3. Find **Protected customer data** section
4. Complete the declaration:
   - Data accessed: order notes, order tags (via `read_orders` scope)
   - Data stored: order notes and tags are stored in the app database for analysis
   - Deletion: shop data is purged on `shop/redact`; customer data on `customers/redact`
5. Submit for Shopify review
6. Once approved, un-comment the three compliance webhook blocks in `shopify.app.production.toml`:
   - `customers/data_request`
   - `customers/redact`
   - `shop/redact`
7. Re-run: `npx @shopify/cli@4.1.0 app deploy --config shopify.app.production.toml --allow-updates`

## 2. App listing requirements

| Field | Required | Notes |
|---|---|---|
| Privacy policy URL | Yes | Must describe what data is stored and how it is deleted |
| Terms of service URL | Yes | |
| Support email | Yes | |
| App icon | Yes | 1200×1200 px |
| Feature image | Yes | 1600×900 px |

## 3. Scopes justification

| Scope | Justification |
|---|---|
| `read_products` | Sync product titles, descriptions, tags, collections for objection analysis |
| `write_products` | Reserved for future FAQ metafield writes (not active in v1) |
| `read_orders` | Read order notes and tags to extract customer buying signals |
| `read_content` | Read page content to detect gaps and suggest improvements |
| `write_content` | Write FAQ pages and content recovery assets to the storefront |

## 4. Data handling summary (for declaration form)

**What data is accessed:**
- Product metadata (title, description, tags, collections) — no PII
- Order notes and tags — may contain merchant-entered text; no customer PII fields (name, email, address) are fetched

**What is stored:**
- Copies of product metadata in the app database, scoped to the merchant's shop
- Order notes/tags for analysis, scoped to the merchant's shop

**Retention and deletion:**
- `shop/redact` webhook: all shop-scoped data is permanently deleted within 30 days of uninstall
- `customers/redact` webhook: no customer PII is stored; handler logs the request and no-ops
- `customers/data_request` webhook: responds that no customer-identifiable data is held

## 5. Billing copy compliance

Revenue claims in the UI have been softened to avoid guarantees. All estimates are clearly
labeled as projections. The support page (`/support`) includes the following disclaimer:

> Revenue estimates are conservative projections based on industry benchmarks
> (average order value × estimated conversion lift). They are directional, not guaranteed outcomes.

## 6. Post-approval deploy command

Run from a Node 22 environment (`nvm use 22`):

```bash
npx @shopify/cli@4.1.0 app deploy \
  --config shopify.app.production.toml \
  --allow-updates
```
