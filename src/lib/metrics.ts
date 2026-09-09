// Metrics builder (tasks 6.2, 6.2a, 6.3; design D14 & D16).
//
// Serves each requested day by rollup PRESENCE, not by the calendar:
//   - a completed day with a rollup doc  -> read the doc (cheap)
//   - a completed day with no rollup doc -> live-compute from raw, and
//     (write-through, 6.2a) memoize it back as that day's rollup
//   - the current UTC day                -> always live-compute, never persist
// Only day(s) missing a rollup are ever live-computed on a load (D16 layer 1).

import { Timestamp } from '../firestore.js';
import { config } from '../config.js';
import { aggregateDay, mergeHuman, mergeBot, emptyHuman } from './aggregate.js';
import { rollupRef } from './rollup.js';
import { getSiteSections } from '../validate.js';
import { dateRange, todayKey } from './dates.js';
import type {
  DayAggregate,
  HumanAggregate,
  MetricsDay,
  MetricsResponse,
  RollupDoc,
} from '../types.js';

async function readRollup(
  siteId: string,
  dateKey: string,
): Promise<DayAggregate | null> {
  const doc = await rollupRef(siteId, dateKey).get();
  if (!doc.exists) return null;
  const d = doc.data() as RollupDoc;
  return { date: d.date, site_id: d.site_id, human: d.human, bot: d.bot };
}

function toMetricsDay(
  agg: DayAggregate,
  includeBots: boolean,
  live: boolean,
): MetricsDay {
  const merged: HumanAggregate = emptyHuman();
  mergeHuman(merged, agg.human);
  if (includeBots) mergeBot(merged, agg.bot);
  return {
    date: agg.date,
    sessions: merged.sessions,
    engaged_sessions: merged.engaged_sessions,
    bot_sessions: agg.bot.sessions,
    human_sessions: agg.human.sessions,
    funnel: merged.funnel,
    referrers: merged.referrers,
    countries: merged.countries,
    clicks: merged.clicks,
    live,
  };
}

/** Resolve one day's aggregate via presence-based fallback (D16 layer 1). */
async function resolveDay(
  siteId: string,
  dateKey: string,
  sectionsOrder: string[],
  today: string,
): Promise<{ agg: DayAggregate; live: boolean }> {
  if (dateKey === today) {
    // Current day: always live, never persisted (D16 write-through guard).
    const agg = await aggregateDay(siteId, dateKey, sectionsOrder);
    return { agg, live: true };
  }
  const rollup = await readRollup(siteId, dateKey);
  if (rollup) return { agg: rollup, live: false };

  // Completed day missing a rollup: live-compute and (6.2a) memoize.
  const agg = await aggregateDay(siteId, dateKey, sectionsOrder);
  if (config.metricsWriteThrough) {
    const doc: RollupDoc = { ...agg, computed_at: Timestamp.now() };
    await rollupRef(siteId, dateKey)
      .set(doc)
      .catch((err) =>
        console.warn(`[metrics] write-through failed ${siteId}/${dateKey}: ${err.message}`),
      );
  }
  return { agg, live: true };
}

export async function buildMetrics(
  siteId: string,
  from: string,
  to: string,
  includeBots: boolean,
): Promise<MetricsResponse> {
  // Use the TTL-cached sections from validate.ts instead of a raw Firestore read
  // on every request (finding 5).
  const sectionsOrder = await getSiteSections(siteId);
  const today = todayKey();
  const keys = dateRange(from, to);

  // Resolve all days in parallel — independent operations, no ordering constraint.
  // Eliminates up to 90 serial Firestore round-trips for a 30-day window (finding 7).
  const results = await Promise.all(
    keys.map((key) => resolveDay(siteId, key, sectionsOrder, today)),
  );
  const days = results.map(({ agg, live }) => toMetricsDay(agg, includeBots, live));

  // Totals are the sum of the per-day MetricsDay values, which already honor
  // include_bots — so the window total is consistent with each day's numbers.
  const totals = {
    sessions: 0,
    engaged_sessions: 0,
    bot_sessions: 0,
    human_sessions: 0,
    funnel: {} as Record<string, number>,
    referrers: {} as Record<string, number>,
    countries: {} as Record<string, number>,
    clicks: {} as Record<string, number>,
  };
  const add = (into: Record<string, number>, from: Record<string, number>) => {
    for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
  };
  for (const day of days) {
    totals.sessions += day.sessions;
    totals.engaged_sessions += day.engaged_sessions;
    totals.bot_sessions += day.bot_sessions;
    totals.human_sessions += day.human_sessions;
    add(totals.funnel, day.funnel);
    add(totals.referrers, day.referrers);
    add(totals.countries, day.countries);
    add(totals.clicks, day.clicks);
  }
  // Ensure funnel carries every section in order (zeros included).
  for (const section of sectionsOrder) {
    if (totals.funnel[section] === undefined) totals.funnel[section] = 0;
  }

  return {
    site_id: siteId,
    range: { from, to },
    include_bots: includeBots,
    sections_order: sectionsOrder,
    days,
    totals,
  };
}
