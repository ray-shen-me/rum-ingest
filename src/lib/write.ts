// Firestore write logic for a single beacon (tasks 3.5-3.8, design D5 & D7).
//
// Bots get a single session-level document and NO event/pageview docs (D7
// write-cap). Humans get session + pageview upserts plus section_view/click
// event docs, linked by session_id and stamped with site_id (D5).

import { db, Timestamp } from '../firestore.js';
import { getSiteSections } from '../validate.js';
import { classifyBot, deviceTypeFromUa, type DeviceType } from '../bots.js';
import { geoFromXff } from '../geo.js';
import type {
  BeaconPayload,
  EventDoc,
  PageviewDoc,
  SessionDoc,
} from '../types.js';

export function furthestSection(
  order: string[],
  a: string | null,
  b: string | null | undefined,
): string | null {
  if (!b) return a;
  if (!a) return b;
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  return ib > ia ? b : a;
}

export interface RequestMeta {
  xff: string | undefined;
  ua: string | undefined;
}

/** Ingest one beacon: derive geo/device/bot, then persist per D5/D7. */
export async function writeBeacon(p: BeaconPayload, meta: RequestMeta): Promise<void> {
  const database = db();
  const now = Timestamp.now();

  // Derive-then-discard: geo from the trusted IP, device from the UA (D6, D9).
  const { country, city } = geoFromXff(meta.xff);
  const deviceType: DeviceType = deviceTypeFromUa(meta.ua);
  const verdict = classifyBot(meta.ua, p.signals, p.engaged_ms);

  const sections = await getSiteSections(p.site);
  const referrerHost = hostOf(p.ref);

  const sessionId = `${p.site}__${p.sid}`;
  const sessionRef = database.collection('sessions').doc(sessionId);

  // --- Session upsert (transaction so first_seen is written exactly once) ---
  await database.runTransaction(async (tx) => {
    const snap = await tx.get(sessionRef);
    if (!snap.exists) {
      const doc: SessionDoc = {
        session_id: p.sid,
        site_id: p.site,
        first_seen: now,
        last_seen: now,
        referrer_host: referrerHost,
        country,
        city,
        device_type: deviceType,
        is_bot: verdict.is_bot,
        bot_reason: verdict.bot_reason,
        engaged_ms: p.engaged_ms ?? 0,
        max_section: p.max_section ?? null,
      };
      tx.set(sessionRef, doc);
    } else {
      const cur = snap.data() as SessionDoc;
      const update: Partial<SessionDoc> = {
        last_seen: now,
        engaged_ms: Math.max(cur.engaged_ms ?? 0, p.engaged_ms ?? 0),
        max_section: furthestSection(sections, cur.max_section, p.max_section),
      };
      // Bot verdict is sticky: once a session is a bot it stays one.
      if (verdict.is_bot && !cur.is_bot) {
        update.is_bot = true;
        update.bot_reason = verdict.bot_reason;
      }
      // Fill dimensions only if not already set (first non-null wins).
      if (!cur.referrer_host && referrerHost) update.referrer_host = referrerHost;
      if (!cur.country && country) update.country = country;
      if (!cur.city && city) update.city = city;
      if (cur.device_type === 'unknown' && deviceType !== 'unknown') {
        update.device_type = deviceType;
      }
      tx.update(sessionRef, update);
    }
  });

  // Bots stop here: no pageview/event docs (D7 write-cap).
  if (verdict.is_bot) return;

  const batch = database.batch();

  // --- Pageview upsert (per page load; reloads are distinct pvids, D5) ---
  // pageview: write the full doc including entered_at (the true page-load time).
  // flush:    update only engaged_ms and max_section — never touch entered_at,
  //           and never write null over a previously stored max_section (findings 2 & 9).
  if (p.t === 'pageview') {
    const pvRef = database.collection('pageviews').doc(`${p.site}__${p.pvid}`);
    const pv: PageviewDoc = {
      pageview_id: p.pvid,
      session_id: p.sid,
      site_id: p.site,
      page: p.page,
      entered_at: now,
      engaged_ms: p.engaged_ms ?? 0,
      max_section: p.max_section ?? null,
    };
    batch.set(pvRef, pv);
  } else if (p.t === 'flush') {
    const pvRef = database.collection('pageviews').doc(`${p.site}__${p.pvid}`);
    // Only update the fields that a flush can legitimately advance.
    // mergeFields ensures all other fields (entered_at, session_id, etc.) are untouched.
    const updates: Partial<PageviewDoc> = { engaged_ms: p.engaged_ms ?? 0 };
    const mergeFields: string[] = ['engaged_ms'];
    if (p.max_section != null) {
      updates.max_section = p.max_section;
      mergeFields.push('max_section');
    }
    batch.set(pvRef, updates, { mergeFields });
  }

  // --- section_view events (batched on flush) ---
  if (p.t === 'flush' && p.sections && p.sections.length > 0) {
    for (const slug of p.sections) {
      // Deterministic id dedupes repeat section_views for the same pageview.
      const id = `${p.site}__${p.pvid}__sv__${slug}`;
      const ev: EventDoc = {
        session_id: p.sid,
        site_id: p.site,
        pageview_id: p.pvid,
        type: 'section_view',
        target: slug,
        href_host: null,
        at: now,
      };
      batch.set(database.collection('events').doc(id), ev, { merge: true });
    }
  }

  // --- click event (immediate beacon) ---
  if (p.t === 'click' && p.target) {
    const ev: EventDoc = {
      session_id: p.sid,
      site_id: p.site,
      pageview_id: p.pvid,
      type: 'click',
      target: p.target,
      href_host: p.href_host ?? null,
      at: now,
    };
    // Auto-id: each click beacon is a distinct event.
    batch.set(database.collection('events').doc(), ev);
  }

  await batch.commit();
}

/** Reduce a referrer URL to its hostname (D9). Returns null if unusable. */
function hostOf(ref: string | undefined): string | null {
  if (!ref) return null;
  try {
    return new URL(ref).hostname || null;
  } catch {
    return null;
  }
}
