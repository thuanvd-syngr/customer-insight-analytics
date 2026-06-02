#!/usr/bin/env bash
set -euo pipefail

REGION="${REGION:-asia-southeast1}"
SERVICE_NAME="${SERVICE_NAME:-customer-insight-analytics}"
SQL_INSTANCE="${SQL_INSTANCE:-customer-insight-db}"
DATABASE_NAME="${DATABASE_NAME:-customer_insight}"
DB_USER="${DB_USER:-postgres}"
PROJECT_ID="${PROJECT_ID:-}"
CREATE_SQL="${CREATE_SQL:-false}"
RUN_MIGRATION_JOB="${RUN_MIGRATION_JOB:-false}"

usage() {
  cat <<'EOF'
Deploy Customer Insight Analytics to Cloud Run for production testing.

Required:
  PROJECT_ID=your-gcp-project-id

Optional:
  REGION=asia-southeast1
  SERVICE_NAME=customer-insight-analytics
  SQL_INSTANCE=customer-insight-db
  DATABASE_NAME=customer_insight
  DB_USER=postgres
  CREATE_SQL=true          Create Cloud SQL instance and database before deploy.
  RUN_MIGRATION_JOB=true   Create/execute a Cloud Run migration job after deploy.

Required Secret Manager secrets before deploy:
  SHOPIFY_API_KEY
  SHOPIFY_API_SECRET
  DATABASE_URL

Example:
  PROJECT_ID=my-project CREATE_SQL=true ./scripts/cloud-run-test-deploy.sh
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "$PROJECT_ID" ]]; then
  usage
  echo "Missing PROJECT_ID." >&2
  exit 1
fi

command -v gcloud >/dev/null 2>&1 || {
  echo "gcloud CLI is required." >&2
  exit 1
}

SQL_CONNECTION="${PROJECT_ID}:${REGION}:${SQL_INSTANCE}"
TEMP_URL="https://TEMP_REPLACE_AFTER_DEPLOY"
SCOPES="read_products,read_orders,read_content"

echo "Using project: ${PROJECT_ID}"
gcloud config set project "$PROJECT_ID"

echo "Enabling required APIs..."
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com

if [[ "$CREATE_SQL" == "true" ]]; then
  echo "Creating Cloud SQL instance if needed..."
  if ! gcloud sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1; then
    gcloud sql instances create "$SQL_INSTANCE" \
      --database-version=POSTGRES_16 \
      --tier=db-f1-micro \
      --region="$REGION" \
      --storage-size=10GB \
      --availability-type=zonal
  fi

  echo "Creating database if needed..."
  if ! gcloud sql databases describe "$DATABASE_NAME" --instance="$SQL_INSTANCE" >/dev/null 2>&1; then
    gcloud sql databases create "$DATABASE_NAME" --instance="$SQL_INSTANCE"
  fi

  echo "Set the ${DB_USER} password manually if you have not already:"
  echo "gcloud sql users set-password ${DB_USER} --instance=${SQL_INSTANCE} --password='CHANGE_ME_STRONG_PASSWORD'"
fi

for secret in SHOPIFY_API_KEY SHOPIFY_API_SECRET DATABASE_URL; do
  if ! gcloud secrets describe "$secret" >/dev/null 2>&1; then
    echo "Missing Secret Manager secret: ${secret}" >&2
    echo "Create it before deploy. See docs/CLOUD_RUN_TEST_DEPLOY.md." >&2
    exit 1
  fi
done

echo "Deploying Cloud Run service with temporary app URL..."
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --add-cloudsql-instances "$SQL_CONNECTION" \
  --set-env-vars "NODE_ENV=production,SHOPIFY_BILLING_TEST=true,SHOPIFY_APP_URL=${TEMP_URL},HOST=${TEMP_URL},SCOPES=${SCOPES}" \
  --set-secrets "SHOPIFY_API_KEY=SHOPIFY_API_KEY:latest,SHOPIFY_API_SECRET=SHOPIFY_API_SECRET:latest,DATABASE_URL=DATABASE_URL:latest"

CLOUD_RUN_URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --format='value(status.url)')"

if [[ -z "$CLOUD_RUN_URL" ]]; then
  echo "Cloud Run deploy finished, but service URL was not found." >&2
  exit 1
fi

echo "Updating service env with Cloud Run URL: ${CLOUD_RUN_URL}"
gcloud run services update "$SERVICE_NAME" \
  --region "$REGION" \
  --update-env-vars "SHOPIFY_APP_URL=${CLOUD_RUN_URL},HOST=${CLOUD_RUN_URL}"

if [[ "$RUN_MIGRATION_JOB" == "true" ]]; then
  JOB_NAME="${SERVICE_NAME}-migrate"
  echo "Creating migration job if needed..."
  if ! gcloud run jobs describe "$JOB_NAME" --region "$REGION" >/dev/null 2>&1; then
    gcloud run jobs create "$JOB_NAME" \
      --region "$REGION" \
      --source . \
      --set-cloudsql-instances "$SQL_CONNECTION" \
      --set-secrets "DATABASE_URL=DATABASE_URL:latest,SHOPIFY_API_KEY=SHOPIFY_API_KEY:latest,SHOPIFY_API_SECRET=SHOPIFY_API_SECRET:latest" \
      --set-env-vars "NODE_ENV=production" \
      --command npx \
      --args prisma,migrate,deploy
  fi

  echo "Executing migration job..."
  gcloud run jobs execute "$JOB_NAME" --region "$REGION" --wait
fi

echo
echo "Cloud Run URL: ${CLOUD_RUN_URL}"
echo
echo "Next steps:"
echo "1. Replace CLOUD_RUN_URL in shopify.app.production.toml with ${CLOUD_RUN_URL}."
echo "2. Replace YOUR_PRODUCTION_CLIENT_ID with the Shopify production client ID."
echo "3. Run: shopify app config use shopify.app.production.toml"
echo "4. Run: shopify app config push"
echo "5. Test: curl -I ${CLOUD_RUN_URL}/health"
