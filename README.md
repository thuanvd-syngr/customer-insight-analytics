# Customer Insight Analytics

Shopify embedded app that helps merchants find why customers do not buy. It uses a deterministic keyword engine, Shopify Admin GraphQL imports, usage gating, optional weekly AI summaries, and Prisma/PostgreSQL storage.

## Local Development

1. Install dependencies: `npm ci`
2. Create `.env` from `.env.example`.
3. Generate Prisma: `npx prisma generate`
4. Apply DB migrations: `npm run db:migrate`
5. Link or create a Shopify Partner app: `npm run config:link`
6. Start dev: `npm run dev`

Required production scopes: `read_products,read_orders,read_content`.

For development-only plan testing, set:

```bash
ENABLE_DEV_PLAN_OVERRIDE=true
DEV_PLAN_OVERRIDE=pro
SHOPIFY_BILLING_TEST=true
```

Never enable `ENABLE_DEV_PLAN_OVERRIDE` in production.

## Verify

Run:

```bash
npm run typecheck
npm test
npm run build
```

## Partner App Setup

Create an embedded public app in the Shopify Partner Dashboard. Set the app URL to your tunnel or production URL, add redirect URLs from `shopify.app.toml` or `shopify.app.production.toml`, and configure app-specific webhooks:

- `app/uninstalled` -> `/webhooks/app/uninstalled`
- `app/scopes_update` -> `/webhooks/app/scopes_update`
- `customers/data_request` -> `/webhooks/customers/data_request`
- `customers/redact` -> `/webhooks/customers/redact`
- `shop/redact` -> `/webhooks/shop/redact`

Use managed pricing plan names `Starter`, `Growth`, and `Pro`.

For App Store submission, configure public Privacy Policy, Terms of Service, and Support URLs in Partner Dashboard. This repo does not inject storefront scripts or theme assets.

## App Store Submission Checklist

Before submitting the production app:

- Privacy Policy URL is public and configured in Shopify Partner Dashboard.
- Terms of Service URL is public and configured in Shopify Partner Dashboard.
- Support URL is public and configured in Shopify Partner Dashboard.
- App listing screenshots are uploaded in Partner Dashboard.
- Billing has been validated on a Shopify test store with `SHOPIFY_BILLING_TEST=true`; set `SHOPIFY_BILLING_TEST=false` before real production charges.
- Uninstall and GDPR webhook handling has been tested: `npm test -- tests/webhook-uninstall.test.ts tests/gdpr-webhooks.test.ts`.
- `shopify.app.production.toml` has the real production `client_id`, `application_url`, and redirect URLs before deploying the Shopify app config.

## AI Summaries

The app works without AI. Set `AI_PROVIDER=mock`, `groq`, or `gemini` to enable summaries. `groq` needs `GROQ_API_KEY`; `gemini` needs `GEMINI_API_KEY`.

## Production

Use `.env.production.example` as the required variable list. Run `npm run check:env` before deploy. The production start script runs `prisma migrate deploy` and then serves Remix on `$PORT`.

Set `SHOPIFY_BILLING_TEST=false` for real charges, or `true` only for test stores while validating billing.

For Cloud Run test deployment without a custom domain, use [docs/CLOUD_RUN_TEST_DEPLOY.md](docs/CLOUD_RUN_TEST_DEPLOY.md) and `scripts/cloud-run-test-deploy.sh`.
