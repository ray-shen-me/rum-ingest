// GET /metrics — authenticated, site-scoped aggregates (tasks 6.1-6.3, D10).

import type { Request, Response } from 'express';
import { setMetricsCors, isPreflight } from '../lib/cors.js';
import { verifyMetricsCaller } from '../lib/auth.js';
import { buildMetrics } from '../lib/metrics.js';
import { config } from '../config.js';
import { isValidDateKey, todayKey, toDateKey } from '../lib/dates.js';

function defaultFrom(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 29); // last 30 days inclusive
  return toDateKey(d);
}

export async function handleMetrics(req: Request, res: Response): Promise<void> {
  setMetricsCors(req, res, config.dashOrigin);

  if (isPreflight(req)) {
    res.status(204).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).end();
    return;
  }

  // Token verification is the boundary — never trust a plain header (C3, D10).
  const authResult = await verifyMetricsCaller(req.header('authorization'));
  if (!authResult.ok) {
    res.status(authResult.status).json({ error: authResult.error });
    return;
  }

  const siteId = String(req.query.site_id ?? '').trim();
  if (!siteId) {
    res.status(400).json({ error: 'site_id is required' });
    return;
  }

  const from = String(req.query.from ?? '').trim() || defaultFrom();
  const to = String(req.query.to ?? '').trim() || todayKey();
  if (!isValidDateKey(from) || !isValidDateKey(to) || from > to) {
    res.status(400).json({ error: 'invalid from/to (expected YYYY-MM-DD, from <= to)' });
    return;
  }

  // Bots excluded by default (6.3, D7).
  const includeBots = String(req.query.include_bots ?? '') === 'true';

  try {
    const metrics = await buildMetrics(siteId, from, to, includeBots);
    res.status(200).json(metrics);
  } catch (err) {
    console.error(`[metrics] build failed: ${(err as Error).message}`);
    res.status(500).json({ error: 'failed to build metrics' });
  }
}
