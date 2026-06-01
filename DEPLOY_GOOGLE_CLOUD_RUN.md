# Deploy to Google Cloud Run

## 1. Create Cloud SQL Postgres

```bash
gcloud sql instances create cia-postgres --database-version=POSTGRES_16 --tier=db-f1-micro --region=asia-southeast1
gcloud sql databases create customer_insight --instance=cia-postgres
gcloud sql users set-password postgres --instance=cia-postgres --password='REPLACE_ME'
```

Build `DATABASE_URL` from the Cloud SQL connection method you choose. For private IP or connector deployments, use the instance private address.

## 2. Configure Shopify

Create or update the production Partner app:

- App URL: `https://YOUR_CLOUD_RUN_URL`
- Redirect URL: `https://YOUR_CLOUD_RUN_URL/auth/callback`
- Scopes: `read_products,read_orders,read_customers,read_content`
- Webhooks: `/webhooks/app/uninstalled`, `/webhooks/app/scopes_update`

Update `shopify.app.production.toml` placeholders and run:

```bash
shopify app config use shopify.app.production.toml
shopify app config push
```

## 3. Build and Deploy

```bash
gcloud builds submit --tag asia-southeast1-docker.pkg.dev/PROJECT_ID/apps/customer-insight-analytics
gcloud run deploy customer-insight-analytics \
  --image asia-southeast1-docker.pkg.dev/PROJECT_ID/apps/customer-insight-analytics \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production
```

Set secrets or env vars for `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `DATABASE_URL`, `SCOPES=read_products,read_orders,read_customers,read_content`, `NODE_ENV=production`, and `SHOPIFY_BILLING_TEST=false`. Prefer Secret Manager for secrets.

Cloud SQL Unix socket URLs are supported by Prisma's PostgreSQL connector when the host is encoded in `DATABASE_URL`, for example:

```text
postgresql://USER:PASSWORD@localhost/DB?host=/cloudsql/PROJECT:REGION:INSTANCE
```

## 4. Verify

```bash
curl https://YOUR_CLOUD_RUN_URL/health
curl https://YOUR_CLOUD_RUN_URL/health/config
```

Run a test install from the Partner Dashboard, sync product and order data, import real customer questions, run analysis, generate a weekly report, and uninstall to verify webhook cleanup.
