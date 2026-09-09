// Daily rollup writer + runner (tasks 5.1-5.5, design D14 & D16).
//
// A rollup is one `rollups/{siteId}/daily/{date}` doc holding the day's
// aggregates. Writing is idempotent: the doc is recomputed from raw and `set()`
// (full overwrite), so re-runs never double counts (task 5.3).

import { db, Timestamp } from '../firestore.js';
import { config } from '../config.js';
import { aggregateDay } from './aggregate.js';
import { yesterdayKey, trailingDays, isValidDateKey } from './dates.js';
import type { RollupDoc, SiteDoc } from '../types.js';

export interface SiteInfo {
  id: string;
  sections: string[];
}

export async function getSites(): Promise<SiteInfo[]> {
  const snap = await db().collection('sites').get();
  return snap.docs.map((d) => {
    const data = d.data() as SiteDoc;
    return { id: d.id, sections: Array.isArray(data.sections) ? data.sections : [] };
  });
}

// Exported so metrics.ts can share the same ref builder (finding 6).
export function rollupRef(siteId: string, dateKey: string) {
  return db().collection('rollups').doc(siteId).collection('daily').doc(dateKey);
}

export async function rollupExists(siteId: string, dateKey: string): Promise<boolean> {
  const doc = await rollupRef(siteId, dateKey).get();
  return doc.exists;
}

/** Recompute and write one (site, day) rollup. Idempotent overwrite. */
export async function writeRollup(site: SiteInfo, dateKey: string): Promise<void> {
  const agg = await aggregateDay(site.id, dateKey, site.sections);
  const doc: RollupDoc = { ...agg, computed_at: Timestamp.now() };
  await rollupRef(site.id, dateKey).set(doc);
}

export interface RollupRunOptions {
  /** Explicit target date(s). Defaults to yesterday (UTC). */
  dates?: string[];
  /** Also backfill any missing rollup in the trailing window (task 5.4). */
  backfill?: boolean;
}

export interface RollupRunResult {
  written: Array<{ site: string; date: string }>;
  backfilled: Array<{ site: string; date: string }>;
  errors: Array<{ site: string; date: string; error: string }>;
}

/**
 * Run rollups. On a scheduled run (no explicit dates) this rolls up yesterday
 * and backfills any missing day in the trailing window so a missed run
 * self-heals (D16 layers 2-3). With explicit dates it rebuilds exactly those
 * (on-demand rebuild, task 5.5).
 */
export async function runRollup(opts: RollupRunOptions = {}): Promise<RollupRunResult> {
  const result: RollupRunResult = { written: [], backfilled: [], errors: [] };
  const sites = await getSites();

  const targets = (opts.dates && opts.dates.length > 0 ? opts.dates : [yesterdayKey()])
    .filter(isValidDateKey);

  for (const site of sites) {
    for (const date of targets) {
      try {
        await writeRollup(site, date);
        result.written.push({ site: site.id, date });
      } catch (err) {
        result.errors.push({ site: site.id, date, error: (err as Error).message });
      }
    }

    if (opts.backfill) {
      for (const date of trailingDays(config.backfillDays)) {
        if (targets.includes(date)) continue; // already rebuilt above
        try {
          if (!(await rollupExists(site.id, date))) {
            await writeRollup(site, date);
            result.backfilled.push({ site: site.id, date });
          }
        } catch (err) {
          result.errors.push({ site: site.id, date, error: (err as Error).message });
        }
      }
    }
  }

  return result;
}
