// POST /rollup — Cloud Scheduler-triggered daily aggregation (tasks 5.1-5.5).
//
// Protected so only Cloud Scheduler (verified OIDC identity) — or a manual
// admin token — can invoke it; public callers are rejected (task 5.3, D14).

import type { Request, Response } from 'express';
import { verifyRollupCaller } from '../lib/auth.js';
import { runRollup } from '../lib/rollup.js';
import { isValidDateKey, dateRange } from '../lib/dates.js';

export async function handleRollup(req: Request, res: Response): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const authResult = await verifyRollupCaller(req.header('authorization'));
  if (!authResult.ok) {
    res.status(authResult.status).json({ error: authResult.error });
    return;
  }

  // Optional on-demand target (task 5.5): a single date or a from/to range.
  // Body is parsed as JSON for this route (see index.ts).
  const body = (req.body ?? {}) as { date?: string; from?: string; to?: string };
  let dates: string[] | undefined;

  if (body.date) {
    if (!isValidDateKey(body.date)) {
      res.status(400).json({ error: 'invalid date (expected YYYY-MM-DD)' });
      return;
    }
    dates = [body.date];
  } else if (body.from && body.to) {
    if (!isValidDateKey(body.from) || !isValidDateKey(body.to) || body.from > body.to) {
      res.status(400).json({ error: 'invalid from/to range' });
      return;
    }
    dates = dateRange(body.from, body.to);
  }

  // Scheduled runs (no explicit dates) roll up yesterday and backfill the
  // trailing window so a missed run self-heals (D16 layers 2-3).
  const backfill = !dates;

  try {
    const result = await runRollup({ dates, backfill });
    res.status(200).json(result);
  } catch (err) {
    console.error(`[rollup] run failed: ${(err as Error).message}`);
    res.status(500).json({ error: 'rollup run failed' });
  }
}
