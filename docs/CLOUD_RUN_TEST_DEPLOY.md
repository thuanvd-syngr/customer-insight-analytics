# Cloud Run Test Deploy

This guide deploys the Shopify Remix app to Google Cloud Run with Cloud SQL PostgreSQL for production testing. It uses the Cloud Run URL directly, without a custom domain, ngrok, or a tunnel.

Do not commit secrets. Store Shopify and database values in Secret Manager. The current Cloud Run service uses these secret names:

- `customer-insight-shopify-api-key`
- `customer-insight-shopify-api-secret`
- `customer-insight-database-url`

## Repo Check

- `package.json`: production start command is `node ./scripts/start-production.mjs`.
- `Dockerfile`: builds Remix, generates Prisma client, exposes `8080`, and starts the production script.
- `prisma/schema.prisma`: Prisma reads PostgreSQL from `env("DATABASE_URL")`.
- `app/shopify.server.ts`: Shopify uses `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, and `SHOPIFY_APP_URL` from env.
- `app/db.server.ts`: Prisma client is created from runtime env.
- `scripts/start-production.mjs`: runs `prisma migrate deploy`, then starts Remix on Cloud Run's `$PORT`.
- `shopify.app.production.toml`: production scopes exclude `read_customers` and include the content/product write scopes needed for publish tests.
- No production path should use localhost, ngrok, tunnel, or a hardcoded dev URL.

The current GDPR webhook routes in this repo are:

- `/webhooks/app/uninstalled`
- `/webhooks/app/scopes_update`
- `/webhooks/customers/data_request`
- `/webhooks/customers/redact`
- `/webhooks/shop/redact`

In `shopify.app.production.toml`, these mandatory privacy webhooks must use `compliance_topics`, not regular `topics`.

## 1. Set Project

```bash
gcloud config set project PROJECT_ID
```

## 2. Enable APIs

```bash
gcloud services enable run.googleapis.com
gcloud services enable sqladmin.googleapis.com
gcloud services enable cloudbuild.googleapis.com
gcloud services enable artifactregistry.googleapis.com
gcloud services enable secretmanager.googleapis.com
```

## 3. Create Cloud SQL PostgreSQL

```bash
gcloud sql instances create customer-insight-db \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=asia-southeast1 \
  --storage-size=10GB \
  --availability-type=zonal
```

## 4. Create Database

```bash
gcloud sql databases create customer_insight \
  --instance=customer-insight-db
```

## 5. Set Postgres Password

```bash
gcloud sql users set-password postgres \
  --instance=customer-insight-db \
  --password='CHANGE_ME_STRONG_PASSWORD'
```

## 6. Store Secrets

Create or update Shopify secrets:

```bash
printf 'SHOPIFY_PRODUCTION_API_KEY' | gcloud secrets create customer-insight-shopify-api-key --data-file=-
printf 'SHOPIFY_PRODUCTION_API_SECRET' | gcloud secrets create customer-insight-shopify-api-secret --data-file=-
```

If a secret already exists, add a new version:

```bash
printf 'SHOPIFY_PRODUCTION_API_KEY' | gcloud secrets versions add customer-insight-shopify-api-key --data-file=-
printf 'SHOPIFY_PRODUCTION_API_SECRET' | gcloud secrets versions add customer-insight-shopify-api-secret --data-file=-
```

Build the Cloud SQL Unix socket `DATABASE_URL`:

```text
postgresql://postgres:CHANGE_ME_STRONG_PASSWORD@localhost/customer_insight?host=/cloudsql/PROJECT_ID:asia-southeast1:customer-insight-db
```

Store it in Secret Manager:

```bash
printf 'postgresql://postgres:CHANGE_ME_STRONG_PASSWORD@localhost/customer_insight?host=/cloudsql/PROJECT_ID:asia-southeast1:customer-insight-db' \
  | gcloud secrets create customer-insight-database-url --data-file=-
```

If it already exists:

```bash
printf 'postgresql://postgres:CHANGE_ME_STRONG_PASSWORD@localhost/customer_insight?host=/cloudsql/PROJECT_ID:asia-southeast1:customer-insight-db' \
  | gcloud secrets versions add customer-insight-database-url --data-file=-
```

## 7. Deploy First Revision

If you do not know the Cloud Run URL yet, deploy once with a temporary app URL:

```bash
gcloud run deploy customer-insight-analytics \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --add-cloudsql-instances PROJECT_ID:asia-southeast1:customer-insight-db \
  --set-env-vars NODE_ENV=production,SHOPIFY_BILLING_TEST=true,SHOPIFY_APP_URL=https://TEMP_REPLACE_AFTER_DEPLOY,HOST=https://TEMP_REPLACE_AFTER_DEPLOY,SCOPES=read_products,write_products,read_orders,read_content,write_content \
  --set-secrets SHOPIFY_API_KEY=customer-insight-shopify-api-key:latest,SHOPIFY_API_SECRET=customer-insight-shopify-api-secret:latest,DATABASE_URL=customer-insight-database-url:latest
```

## 8. Get Cloud Run URL

```bash
gcloud run services describe customer-insight-analytics \
  --region asia-southeast1 \
  --format='value(status.url)'
```

The URL will look like:

```text
https://customer-insight-analytics-PROJECT_NUMBER_OR_HASH.asia-southeast1.run.app
```

Use this value for `SHOPIFY_APP_URL`, `HOST`, `application_url`, and `auth.redirect_urls`.

## 9. Update Cloud Run Env

```bash
gcloud run services update customer-insight-analytics \
  --region asia-southeast1 \
  --update-env-vars SHOPIFY_APP_URL=CLOUD_RUN_URL,HOST=CLOUD_RUN_URL
```

## 10. Run Prisma Migrate

The service start script already runs `prisma migrate deploy` before serving Remix. For an explicit migration step, create a Cloud Run Job:

```bash
gcloud run jobs create customer-insight-migrate \
  --region asia-southeast1 \
  --source . \
  --set-cloudsql-instances PROJECT_ID:asia-southeast1:customer-insight-db \
  --set-secrets DATABASE_URL=customer-insight-database-url:latest,SHOPIFY_API_KEY=customer-insight-shopify-api-key:latest,SHOPIFY_API_SECRET=customer-insight-shopify-api-secret:latest \
  --set-env-vars NODE_ENV=production \
  --command npx \
  --args prisma,migrate,deploy
```

Execute it:

```bash
gcloud run jobs execute customer-insight-migrate \
  --region asia-southeast1 \
  --wait
```

If your `gcloud` version does not support `gcloud run jobs create --source`, build an image and create the job from that image:

```bash
gcloud builds submit --tag asia-southeast1-docker.pkg.dev/PROJECT_ID/apps/customer-insight-analytics

gcloud run jobs create customer-insight-migrate \
  --region asia-southeast1 \
  --image asia-southeast1-docker.pkg.dev/PROJECT_ID/apps/customer-insight-analytics \
  --set-cloudsql-instances PROJECT_ID:asia-southeast1:customer-insight-db \
  --set-secrets DATABASE_URL=customer-insight-database-url:latest,SHOPIFY_API_KEY=customer-insight-shopify-api-key:latest,SHOPIFY_API_SECRET=customer-insight-shopify-api-secret:latest \
  --set-env-vars NODE_ENV=production \
  --command npx \
  --args prisma,migrate,deploy
```

## 11. Test Health and App Routes

```bash
curl -I CLOUD_RUN_URL
curl -I CLOUD_RUN_URL/app
curl -I CLOUD_RUN_URL/health
curl -I CLOUD_RUN_URL/health/config
```

`/app` may redirect or require Shopify Admin embedded context when opened outside Shopify. The main check is that the service responds and does not crash.

## 12. Configure Shopify Production App

After the Cloud Run URL is known, edit `shopify.app.production.toml`:

```toml
client_id = "SHOPIFY_PRODUCTION_CLIENT_ID"
application_url = "CLOUD_RUN_URL"

[auth]
redirect_urls = [
  "CLOUD_RUN_URL/auth/callback"
]
```

Production scopes must stay:

```toml
[access_scopes]
scopes = "read_products,write_products,read_orders,read_content,write_content"
```

Then deploy the Shopify config with the current Shopify CLI:

```bash
shopify app deploy --config production --allow-updates --no-build
```

In Shopify Partner Dashboard, set the same Cloud Run URL as the app URL and configure the app listing:

- Privacy Policy URL
- Terms of Service URL
- Support URL
- App listing screenshots

## 13. Billing and Webhook Tests

Keep test billing enabled while validating on a Shopify test store:

```text
SHOPIFY_BILLING_TEST=true
```

Before real production charges, update Cloud Run:

```bash
gcloud run services update customer-insight-analytics \
  --region asia-southeast1 \
  --update-env-vars SHOPIFY_BILLING_TEST=false
```

Install the app from the Partner Dashboard, sync product/order data, import customer questions, run analysis, generate a report, and uninstall. Confirm the uninstall and GDPR webhook behavior with:

```bash
npm test -- tests/webhook-uninstall.test.ts tests/gdpr-webhooks.test.ts
```
