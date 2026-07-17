# Deploying to Google Cloud Run

The backend ships as a single Docker image (see `Dockerfile`) running on
Cloud Run, backed by Cloud SQL for Postgres. Cloud Run is public
(`--allow-unauthenticated`) because the iOS app can't easily mint GCP
identity tokens -- request-level auth (JWT for user endpoints, the
`x-cron-secret` header for cron endpoints) is what actually protects things,
same as it does locally.

One-time setup and every redeploy are both below. Run these from the
`beento/` directory (this repo), with the `gcloud` CLI installed and
authenticated (`gcloud auth login`).

## 0. One-time project setup

```bash
export PROJECT_ID=your-gcp-project-id
export REGION=us-central1   # pick whatever's closest to your users

gcloud config set project "$PROJECT_ID"

gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  cloudscheduler.googleapis.com \
  secretmanager.googleapis.com

gcloud artifacts repositories create beento \
  --repository-format=docker \
  --location="$REGION"
```

## 1. Create the Cloud SQL Postgres instance (one-time)

```bash
gcloud sql instances create beento-db \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region="$REGION" \
  --storage-auto-increase

gcloud sql databases create beento --instance=beento-db

gcloud sql users create beento \
  --instance=beento-db \
  --password="$(openssl rand -base64 24)"   # save this, you'll need it below
```

`db-f1-micro` is the cheapest tier -- fine for launch traffic, resize later
with `gcloud sql instances patch beento-db --tier=<bigger-tier>` if needed.

## 2. Store secrets in Secret Manager (one-time)

Cloud Run reads these in as env vars at deploy time rather than baking them
into the image.

```bash
# Cloud SQL connection name, e.g. your-project:us-central1:beento-db
export INSTANCE_CONNECTION_NAME=$(gcloud sql instances describe beento-db --format='value(connectionName)')

printf 'postgresql://beento:REPLACE_WITH_DB_PASSWORD@localhost/beento?host=/cloudsql/%s' "$INSTANCE_CONNECTION_NAME" \
  | gcloud secrets create beento-database-url --data-file=-

openssl rand -base64 32 | gcloud secrets create beento-jwt-secret --data-file=-
openssl rand -base64 32 | gcloud secrets create beento-cron-secret --data-file=-

# Get a DSN from your Sentry project's Settings -> Client Keys (DSN).
echo -n "$SENTRY_DSN" | gcloud secrets create beento-sentry-dsn --data-file=-

# From Google Cloud Console -> APIs & Services -> Credentials, for a key with
# the Places API (New) enabled. Places search (GET /places/search) falls back
# to local-DB-only results without this -- see googlePlaces.client.ts.
echo -n "$GOOGLE_PLACES_API_KEY" | gcloud secrets create beento-places-api-key --data-file=-
```

Edit the `beento-database-url` secret's `REPLACE_WITH_DB_PASSWORD` to the
actual password from step 1 before deploying
(`gcloud secrets versions add beento-database-url --data-file=-` to update it).

## 3. Build and push the image

```bash
export IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/beento/backend:$(git rev-parse --short HEAD)"

gcloud auth configure-docker "$REGION-docker.pkg.dev"
docker build -t "$IMAGE" .
docker push "$IMAGE"
```

## 4. Run migrations against Cloud SQL

Migrations run separately from the container start command -- Cloud Run can
run multiple instances concurrently, and you don't want N instances racing
to apply the same migration. Use the Cloud SQL Auth Proxy to reach the
instance from your machine:

```bash
# Downloads a short-lived proxy binary; https://cloud.google.com/sql/docs/postgres/sql-proxy
cloud-sql-proxy "$INSTANCE_CONNECTION_NAME" --port 5434 &

DATABASE_URL="postgresql://beento:REPLACE_WITH_DB_PASSWORD@localhost:5434/beento" \
  npm run prisma:migrate:deploy

kill %1   # stop the proxy
```

Run this step once per new migration, before deploying the code that
depends on it.

## 5. Deploy to Cloud Run

```bash
gcloud run deploy beento-backend \
  --image="$IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --add-cloudsql-instances="$INSTANCE_CONNECTION_NAME" \
  --set-secrets="DATABASE_URL=beento-database-url:latest,JWT_SECRET=beento-jwt-secret:latest,CRON_SECRET=beento-cron-secret:latest,SENTRY_DSN=beento-sentry-dsn:latest,GOOGLE_PLACES_API_KEY=beento-places-api-key:latest" \
  --min-instances=0 \
  --max-instances=10
```

Grab the deployed URL from the command's output (or
`gcloud run services describe beento-backend --region="$REGION" --format='value(status.url)'`)
-- the iOS app's production API base URL (task #22) points here.

To redeploy after a code change: repeat steps 3 and 5 (skip step 4 unless
the schema changed).

## 6. Cloud Scheduler jobs for the cron endpoints

Two endpoints exist purely for scheduled triggering, gated by
`x-cron-secret` rather than a user token (see
`src/middleware/cronAuth.ts`):

- `POST /recommendations/refresh` -- recomputes similarity scores (FR-1x recommendation engine)
- `POST /trips/prompt/notify-all` -- fans out the post-trip logging prompt to co-travelers of trips that ended in the last 24h (FR-33)

```bash
export SERVICE_URL=$(gcloud run services describe beento-backend --region="$REGION" --format='value(status.url)')
export CRON_SECRET_VALUE=$(gcloud secrets versions access latest --secret=beento-cron-secret)

gcloud scheduler jobs create http beento-recommendations-refresh \
  --location="$REGION" \
  --schedule="0 4 * * *" \
  --uri="$SERVICE_URL/recommendations/refresh" \
  --http-method=POST \
  --headers="x-cron-secret=$CRON_SECRET_VALUE"

gcloud scheduler jobs create http beento-notify-all \
  --location="$REGION" \
  --schedule="0 9 * * *" \
  --uri="$SERVICE_URL/trips/prompt/notify-all" \
  --http-method=POST \
  --headers="x-cron-secret=$CRON_SECRET_VALUE"
```

Schedules above are once-daily examples (`recommendations/refresh` at
4am UTC, `notify-all` at 9am UTC) -- adjust to taste. `notify-all`'s 24h
lookback window (see `src/modules/trips/trips.routes.ts`) assumes a
once-daily cadence; if you schedule it more often, either shrink the
window or make the job idempotent-safe some other way (it currently isn't
harmful to run twice -- it just re-checks unlogged places -- but it will
do redundant work).

## Local smoke test

Before deploying, you can sanity-check the image itself:

```bash
docker compose up -d postgres
docker build -t beento-backend:local .
docker run --rm -p 3001:3000 \
  -e DATABASE_URL="postgresql://beento:beento@host.docker.internal:5433/beento" \
  -e JWT_SECRET="local-test-secret" \
  -e CRON_SECRET="local-test-cron-secret" \
  beento-backend:local
# in another shell:
curl http://localhost:3001/health   # expect {"status":"ok"}
```
