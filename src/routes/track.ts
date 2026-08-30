// POST /track — public cross-origin ingest (tasks 3.3-3.8, design D2 & D7).

import type { Request, Response } from 'express';
import { setTrackCors, isPreflight } from '../lib/cors.js';
import { allow } from '../lib/ratelimit.js';
import { clientIpFromXff } from '../geo.js';
import { parseBeacon, isKnownSite } from '../validate.js';
import { writeBeacon } from '../lib/write.js';

export async function handleTrack(req: Request, res: Response): Promise<void> {
  setTrackCors(res);

  // sendBeacon(text/plain) is a CORS simple request, but answer OPTIONS anyway.
  if (isPreflight(req)) {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const xff = req.header('x-forwarded-for');
  const ua = req.header('user-agent');

  // Per-IP rate-limit backstop (D7).
  if (!allow(clientIpFromXff(xff))) {
    res.status(429).end();
    return;
  }

  // Validate shape (3.4). req.body is a raw string (express.text()).
  const parsed = parseBeacon(req.body);
  if (!parsed.ok || !parsed.payload) {
    res.status(400).end();
    return;
  }
  const payload = parsed.payload;

  // Reject unknown site keys — write nothing (3.4, D9a).
  if (!(await isKnownSite(payload.site))) {
    res.status(400).end();
    return;
  }

  // Return promptly; complete the write asynchronously (3.8, D5 M5).
  // On Cloud Run this relies on CPU staying allocated after the response —
  // deploy with --no-cpu-throttling (see README) so the write always completes.
  res.status(204).end();
  writeBeacon(payload, { xff, ua }).catch((err) => {
    console.error(`[track] write failed: ${(err as Error).message}`);
  });
}
