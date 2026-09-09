// Runtime configuration, read from environment variables with sane defaults.

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function list(name: string): string[] {
  const v = process.env[name];
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const config = {
  port: num('PORT', 8080),

  // GCP project (falls back to ADC-provided project on Cloud Run).
  projectId: str('GOOGLE_CLOUD_PROJECT', str('GCLOUD_PROJECT', '')),

  // /metrics auth (D10): emails allowed to read analytics.
  allowlistEmails: list('ALLOWLIST_EMAILS'),
  // CORS origin permitted to call /metrics (the dashboard).
  dashOrigin: str('DASH_ORIGIN', 'https://dash.ray-shen.me'),

  // /rollup auth (D14, task 5.3): the Cloud Scheduler service-account email
  // whose OIDC token is accepted, and the audience the token must target.
  schedulerSaEmail: str('SCHEDULER_SA_EMAIL', '').toLowerCase(),
  rollupAudience: str('ROLLUP_AUDIENCE', ''),
  // Optional shared token for manual/local rollup invocation (documented; off by default).
  rollupAdminToken: str('ROLLUP_ADMIN_TOKEN', ''),

  // Geo (D6).
  geoliteDbPath: str('GEOLITE_DB_PATH', 'geodata/GeoLite2-City.mmdb'),
  // Which X-Forwarded-For position holds the trusted client IP (M3):
  // 'last' (Cloud Run domain-mapping default), 'first', or an integer index
  // counted from the right (0 = last).
  trustedXffPosition: str('TRUSTED_XFF_POSITION', 'last'),

  // Per-IP rate limit backstop on /track (D7, task 3.3).
  rateLimitMax: num('RATE_LIMIT_MAX', 120),
  rateLimitWindowMs: num('RATE_LIMIT_WINDOW_MS', 60_000),

  // Rollup backfill trailing window in days (D16 layer 3, task 5.4).
  backfillDays: num('BACKFILL_DAYS', 7),
  // Whether the metrics endpoint memoizes live-computed completed days by
  // writing them back as rollups (D16 write-through, task 6.2a).
  metricsWriteThrough: str('METRICS_WRITE_THROUGH', 'true') === 'true',

  // Engaged-session threshold (ms). A human session counts as "engaged" when
  // its accumulated visible time meets this bar (documented in docs/data-model.md).
  engagedMsThreshold: num('ENGAGED_MS_THRESHOLD', 10_000),

  // How long allowed site keys are cached from the `sites` collection.
  siteCacheTtlMs: num('SITE_CACHE_TTL_MS', 300_000),
} as const;

export function assertMetricsConfig(): void {
  if (config.allowlistEmails.length === 0) {
    console.warn(
      '[config] ALLOWLIST_EMAILS is empty — /metrics will reject every caller (403).',
    );
  }
}
