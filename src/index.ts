// rum-ingest entrypoint — Cloud Run service (api.ray-shen.me).
// Routes: public POST /track, authed GET /metrics, scheduler-only POST /rollup.

import express from 'express';
import { config, assertMetricsConfig } from './config.js';
import { loadSites } from './validate.js';
import { handleTrack } from './routes/track.js';
import { handleMetrics } from './routes/metrics.js';
import { handleRollup } from './routes/rollup.js';

const app = express();
app.disable('x-powered-by');
// Cloud Run terminates TLS and sets X-Forwarded-For; trust the proxy so
// req IP metadata is sane (we still parse XFF explicitly for the trusted
// client IP, per M3).
app.set('trust proxy', true);

// Body parsers are per-route because /track receives a text/plain sendBeacon
// body while /rollup receives JSON.
const textBody = express.text({ type: '*/*', limit: '16kb' });
const jsonBody = express.json({ limit: '16kb' });

// Health check (Cloud Run readiness).
// Note: /healthz is intercepted by GFE on Cloud Run domain mappings; use /health instead.
app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

// Public ingest.
app.options('/track', handleTrack);
app.post('/track', textBody, handleTrack);

// Authenticated metrics.
app.options('/metrics', handleMetrics);
app.get('/metrics', handleMetrics);

// Scheduler-only rollup.
app.post('/rollup', jsonBody, handleRollup);

assertMetricsConfig();

// Warm the known-site cache at startup (non-fatal if it fails).
loadSites(true).catch(() => {});

app.listen(config.port, () => {
  console.log(`[rum-ingest] listening on :${config.port}`);
});
