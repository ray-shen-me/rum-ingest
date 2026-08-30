// Aggregation core (design D5/H2, D14).
//
// Firestore has no GROUP BY, so all aggregation is done here in app code. This
// module reads the raw session + event docs for a single (site, UTC day) and
// produces a DayAggregate. It is the single source of aggregation logic, shared
// by the rollup job (5.x) and the metrics endpoint's live-compute path (6.2).
//
// The queries are aligned with the composite indexes in firestore.indexes.json
// (task 2.3): sessions by site_id + first_seen, events by site_id + type + at.

import { db, Timestamp } from '../firestore.js';
import { config } from '../config.js';
import { dayBounds } from './dates.js';
import type {
  DayAggregate,
  EventDoc,
  HumanAggregate,
  BotAggregate,
  SessionDoc,
} from '../types.js';

function bump(map: Record<string, number>, key: string | null | undefined, by = 1): void {
  if (!key) return;
  map[key] = (map[key] ?? 0) + by;
}

function emptyHuman(): HumanAggregate {
  return {
    sessions: 0,
    engaged_sessions: 0,
    funnel: {},
    referrers: {},
    countries: {},
    clicks: {},
  };
}

function emptyBot(): BotAggregate {
  return { sessions: 0, referrers: {}, countries: {} };
}

/** Read and aggregate one (site, day) from raw Firestore docs. */
export async function aggregateDay(
  siteId: string,
  dateKey: string,
  sectionsOrder: string[],
): Promise<DayAggregate> {
  const { start, end } = dayBounds(dateKey);
  const startTs = Timestamp.fromDate(start);
  const endTs = Timestamp.fromDate(end);
  const database = db();

  // Sessions for the day (site_id + first_seen index).
  const sessionsSnap = await database
    .collection('sessions')
    .where('site_id', '==', siteId)
    .where('first_seen', '>=', startTs)
    .where('first_seen', '<', endTs)
    .get();

  const human = emptyHuman();
  const bot = emptyBot();
  const humanSessionIds = new Set<string>();

  for (const doc of sessionsSnap.docs) {
    const s = doc.data() as SessionDoc;
    if (s.is_bot) {
      bot.sessions += 1;
      bump(bot.referrers, s.referrer_host);
      bump(bot.countries, s.country);
    } else {
      human.sessions += 1;
      humanSessionIds.add(s.session_id);
      bump(human.referrers, s.referrer_host);
      bump(human.countries, s.country);
      if ((s.engaged_ms ?? 0) >= config.engagedMsThreshold) {
        human.engaged_sessions += 1;
      }
    }
  }

  // Section-view events for the funnel (site_id + type + at index). Bots write
  // no event docs (D7), so every section_view here is human; we still guard on
  // the human session set for safety.
  const svSnap = await database
    .collection('events')
    .where('site_id', '==', siteId)
    .where('type', '==', 'section_view')
    .where('at', '>=', startTs)
    .where('at', '<', endTs)
    .get();

  // Distinct human sessions reaching each section.
  const funnelSets = new Map<string, Set<string>>();
  for (const doc of svSnap.docs) {
    const e = doc.data() as EventDoc;
    if (!humanSessionIds.has(e.session_id)) continue;
    let set = funnelSets.get(e.target);
    if (!set) {
      set = new Set<string>();
      funnelSets.set(e.target, set);
    }
    set.add(e.session_id);
  }
  for (const [section, set] of funnelSets) human.funnel[section] = set.size;
  // Ensure every known section appears (so the funnel renders with zeros).
  for (const section of sectionsOrder) {
    if (human.funnel[section] === undefined) human.funnel[section] = 0;
  }

  // Click events (same index, type = click).
  const clickSnap = await database
    .collection('events')
    .where('site_id', '==', siteId)
    .where('type', '==', 'click')
    .where('at', '>=', startTs)
    .where('at', '<', endTs)
    .get();
  for (const doc of clickSnap.docs) {
    const e = doc.data() as EventDoc;
    if (!humanSessionIds.has(e.session_id)) continue;
    bump(human.clicks, e.target);
  }

  return { date: dateKey, site_id: siteId, human, bot };
}

// --- merge helpers (used to combine days into a window total, D14) ---

function mergeCounts(
  into: Record<string, number>,
  from: Record<string, number>,
): void {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
}

export function mergeHuman(into: HumanAggregate, from: HumanAggregate): void {
  into.sessions += from.sessions;
  into.engaged_sessions += from.engaged_sessions;
  mergeCounts(into.funnel, from.funnel);
  mergeCounts(into.referrers, from.referrers);
  mergeCounts(into.countries, from.countries);
  mergeCounts(into.clicks, from.clicks);
}

export function mergeBot(into: HumanAggregate, from: BotAggregate): void {
  // include_bots: bots contribute session counts and referrer/country dims,
  // but no funnel or clicks (they have no event docs).
  into.sessions += from.sessions;
  mergeCounts(into.referrers, from.referrers);
  mergeCounts(into.countries, from.countries);
}

export { emptyHuman };
