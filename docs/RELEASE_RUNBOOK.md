# Release Runbook — Customer Insight Analytics

Use this checklist before submitting the app for Shopify App Store review or switching a production service from test billing to real billing.

## Current Verified Release Candidate

- Cloud Run service: `customer-insight-analytics`
- Region: `asia-southeast1`
- Latest verified revision: `customer-insight-analytics-00045-ln7`
- App URL: `https://customer-insight-analytics-ww7zt533aa-as.a.run.app`
- Shopify API version: `2026-01`
- Required scopes: `read_products,write_products,read_orders,read_content,write_content`
- Billing mode used for validation: `SHOPIFY_BILLING_TEST=true`

## Preflight Checks

Run these locally before every release candidate deploy:

```bash
npm run typecheck
npm test
npm run build
```

Expected result for the current release candidate:

```text
typecheck: pass
tests: 67 files / 791 tests passed
build: pass
```

Check the deployed service:

```bash
curl -sS https://customer-insight-analytics-ww7zt533aa-as.a.run.app/health/config
```

Expected result:

```json
{"status":"ok","checks":{"SHOPIFY_API_KEY":true,"SHOPIFY_APP_URL_OR_HOST":true,"DATABASE_URL":true,"SCOPES":true,"NODE_ENV":true},"missing":[]}
```

## Cloud Run Deploy

For the current Cloud Run test service:

```bash
gcloud run deploy customer-insight-analytics \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --add-cloudsql-instances project-4cbb3f3b-f323-4120-95b:asia-southeast1:storepilot-db \
  --update-env-vars '^@^NODE_ENV=production@SHOPIFY_BILLING_TEST=true@SHOPIFY_APP_URL=https://customer-insight-analytics-ww7zt533aa-as.a.run.app@HOST=https://customer-insight-analytics-ww7zt533aa-as.a.run.app@SCOPES=read_products,write_products,read_orders,read_content,write_content@AI_PROVIDER=off'
```

The production start script runs `prisma migrate deploy` before serving Remix. If a route fails because a table does not exist, verify that the migration exists and that the Cloud Run service has a valid `DATABASE_URL` secret.

## Real Plan Test Matrix

Validate billing through Shopify managed pricing with `SHOPIFY_BILLING_TEST=true`.

| Plan | Expected access | Validation notes |
|---|---|---|
| Free | Dashboard, import, analysis preview, theme audit basics | FAQ generation, publish actions, widget, analytics, reports, and bulk actions must be locked or disabled. |
| Starter | Revenue opportunity, content gap detection, daily analysis | FAQ generation/publishing, widget, analytics, reports, and bulk actions must stay locked unless specifically listed in plan features. |
| Growth | FAQ generation, Shopify publishing, widget, competitor tracking, weekly reports | Bulk actions and executive exports must stay Pro-only. |
| Pro | All Growth features plus bulk actions and executive exports | Billing must show `Pro` as current plan with no downgrade or wrong `Upgrade to Growth` CTA. |

For each paid plan:

1. Open **Plans & Billing**.
2. Start the subscription flow for the target plan.
3. Approve the Shopify test charge.
4. Return to the embedded app and confirm the current plan.
5. Visit these routes in Shopify Admin:
   - `/app`
   - `/app/billing`
   - `/app/status`
   - `/app/faq`
   - `/app/publish`
   - `/app/bulk`
   - `/app/widget`
   - `/app/reports`
6. Confirm buttons match the plan's feature access and that blocked actions are enforced server-side.

## Current Test Store Results

The latest release candidate was validated on the `indexboost-seo` Shopify test store with real Shopify test subscriptions for Starter, Growth, and Pro.

| Area | Current Pro result |
|---|---|
| Dashboard | Store Revenue Health `52`; `10` questions imported; `18` products synced; estimated recovery `$226-$592/mo`. |
| Billing | Current plan `Pro`; no incorrect `Upgrade to Growth` CTA. |
| Status | Current plan `Pro`; `8 / 8` features enabled; latest analysis score `52/100`. |
| FAQ | Generation and preparation controls available on Pro. |
| Publish | Content and product FAQ scopes granted; page/blog publish controls available on Pro. |
| Bulk | `31` items available; bulk job form available on Pro. |
| Widget | Unlocked on Pro; shows `Needs setup` until product FAQs are published. |
| Reports | Weekly report view and monthly/quarterly exports visible on Pro. |

## Store Review Readiness

Before Shopify App Store submission:

- Set `SHOPIFY_BILLING_TEST=false` for the real production service that will charge merchants.
- Verify the Partner Dashboard managed pricing names exactly match `Starter`, `Growth`, and `Pro`.
- Confirm `shopify.app.production.toml` has the production `client_id`, production `application_url`, and production redirect URL.
- Confirm Privacy Policy, Terms of Service, and Support URLs are public:
  - `/privacy`
  - `/terms`
  - `/support`
- Confirm protected customer data declaration is submitted and approved before enabling production compliance webhooks.
- Re-run webhook tests:

```bash
npm test -- tests/webhook-uninstall.test.ts tests/gdpr-webhooks.test.ts
```

## Rollback

List recent revisions:

```bash
gcloud run revisions list \
  --service customer-insight-analytics \
  --region asia-southeast1
```

Route all traffic to the previous known-good revision:

```bash
gcloud run services update-traffic customer-insight-analytics \
  --region asia-southeast1 \
  --to-revisions PREVIOUS_REVISION=100
```
