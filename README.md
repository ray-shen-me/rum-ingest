# rum-ingest

Real User Monitoring ingest + metrics + rollup service for
[ray-shen.me](https://ray-shen.me), deployed to Cloud Run at `api.ray-shen.me`.

Part of the RUM analytics project (see `add-rum-analytics` design doc). This is
one of three deployables, each its own repo (design D15):

- **rum-ingest** (this repo) — the backend
- **rum-dashboard** — the private analytics SPA
- the tracker script — lives in the portfolio site repo

## What it does

| Route | Access | Purpose |
|---|---|---|
| `POST /track` | public, CORS | Ingest beacons from the tracker (any origin). Validates, geolocates locally, tags bots, writes to Firestore. |
| `GET /metrics` | Firebase ID token + email allowlist | Site-scoped aggregates for the dashboard. Reads daily rollups; live-computes only days missing one. |
| `POST /rollup` | Cloud Scheduler OIDC (or admin token) | Aggregate the prior day (+ backfill) into per-site daily rollup docs. |
| `GET /healthz` | public | Health check. |

Design highlights: cookieless, privacy-respecting (no raw IP / full UA / full
referrer stored, honors GPC/DNT client-side), bots tagged-not-filtered with a
write cap, and dashboard reads decoupled from raw volume via daily rollups.
See the change's `design.md` for the full decision log.

## Stack

Node 22 + TypeScript (full ESM), Express, Firebase Admin (Firestore + Auth),
`isbot`, `@maxmind/geoip2-node`, `google-auth-library`. Runs via `tsx` (no build
step) to avoid ESM/CJS interop friction.

## Local development

```bash
npm install
cp .env.example .env        # fill in ALLOWLIST_EMAILS etc.
npm run typecheck           # tsc --noEmit
npm run dev                 # tsx watch, needs ADC or a Firestore emulator
```

Authenticate ADC for local Firestore access:

```bash
gcloud auth application-default login
export GOOGLE_CLOUD_PROJECT=<your-project>
```

Seed the site registry doc (task 2.2):

```bash
npm run seed
```

Run a rollup locally (task 5.5):

```bash
npm run rollup:local                       # yesterday + backfill
npm run rollup:local -- 2026-08-29         # one day
npm run rollup:local -- 2026-08-01 2026-08-29   # a range
```

## Building the image

The MaxMind GeoLite2 City DB is bundled at build time (task 3.2, design D6). It
requires a free [MaxMind license key](https://www.maxmind.com/en/geolite2/signup)
and is **never committed**.

```bash
docker build --build-arg MAXMIND_LICENSE_KEY=<key> -t rum-ingest .
```

## Firestore indexes

Deploy the composite indexes in `firestore.indexes.json` (task 2.3):

```bash
gcloud firestore indexes composite create ...   # or via firebase deploy --only firestore:indexes
```

## Deployment notes

- Deploy with **CPU always allocated** (`--no-cpu-throttling`) so the
  fire-and-forget Firestore write after the `204` on `/track` always completes
  (task 3.8).
- Attach a service account with Firestore access via Workload Identity (task
  1.7) — no key files.
- Set `SCHEDULER_SA_EMAIL` (and `ROLLUP_AUDIENCE`) to the Cloud Scheduler
  identity so `/rollup` rejects everyone else.

Full provisioning is handled in the change's Phase 4 (GCP setup & deploy).
