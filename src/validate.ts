// Payload validation and site-key allowlist (task 3.4, design D9a).
//
// The site key is not a secret (D9a) — it only partitions data. Validation
// checks the payload is well-formed and the site key is a known/registered
// site, rejecting anything malformed without writing.

import { db } from './firestore.js';
import { config } from './config.js';
import type { BeaconPayload, BeaconType } from './types.js';

const BEACON_TYPES: BeaconType[] = ['pageview', 'flush', 'click'];

// --- known-site cache (loaded from the `sites` collection, TTL-refreshed) ---
// Maps site id -> ordered sections array, so the ingest path can both validate
// the site key and resolve "furthest section reached" without a per-beacon read.
let siteCache: Map<string, string[]> = new Map();
let siteCacheAt = 0;

export async function loadSites(force = false): Promise<Map<string, string[]>> {
  const now = Date.now();
  if (!force && siteCache.size > 0 && now - siteCacheAt < config.siteCacheTtlMs) {
    return siteCache;
  }
  try {
    const snap = await db().collection('sites').get();
    const next = new Map<string, string[]>();
    for (const d of snap.docs) {
      const data = d.data() as { sections?: unknown };
      next.set(d.id, Array.isArray(data.sections) ? (data.sections as string[]) : []);
    }
    siteCache = next;
    siteCacheAt = now;
  } catch (err) {
    console.warn(`[validate] could not refresh sites cache: ${(err as Error).message}`);
    // If we have never successfully loaded (siteCacheAt === 0), rethrow so the
    // route returns 500 rather than silently 400-ing all beacons as unknown sites
    // (finding 8). On subsequent TTL refreshes the stale cache is used instead.
    if (siteCacheAt === 0) throw err;
  }
  return siteCache;
}

export async function isKnownSite(siteId: string): Promise<boolean> {
  const sites = await loadSites();
  return sites.has(siteId);
}

export async function getSiteSections(siteId: string): Promise<string[]> {
  const sites = await loadSites();
  return sites.get(siteId) ?? [];
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
  payload?: BeaconPayload;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Parse and structurally validate a raw beacon body. */
export function parseBeacon(raw: unknown): ValidationResult {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'invalid JSON body' };
    }
  }
  if (typeof obj !== 'object' || obj === null) {
    return { ok: false, error: 'body must be an object' };
  }
  const p = obj as Record<string, unknown>;

  if (!isNonEmptyString(p.site)) return { ok: false, error: 'missing site key' };
  if (!isNonEmptyString(p.sid)) return { ok: false, error: 'missing sid' };
  if (!isNonEmptyString(p.pvid)) return { ok: false, error: 'missing pvid' };
  if (!isNonEmptyString(p.page)) return { ok: false, error: 'missing page' };
  if (typeof p.t !== 'string' || !BEACON_TYPES.includes(p.t as BeaconType)) {
    return { ok: false, error: 'unknown beacon type' };
  }

  const t = p.t as BeaconType;
  if (t === 'click' && !isNonEmptyString(p.target)) {
    return { ok: false, error: 'click beacon missing target' };
  }

  // Bound the arrays/strings we accept to keep writes small and safe.
  const sections = Array.isArray(p.sections)
    ? p.sections.filter(isNonEmptyString).slice(0, 50)
    : undefined;

  const payload: BeaconPayload = {
    site: p.site,
    sid: p.sid,
    pvid: p.pvid,
    t,
    page: String(p.page).slice(0, 512),
    ref: isNonEmptyString(p.ref) ? p.ref.slice(0, 2048) : undefined,
    engaged_ms:
      typeof p.engaged_ms === 'number' && p.engaged_ms >= 0
        ? Math.min(p.engaged_ms, 86_400_000)
        : undefined,
    sections,
    max_section: isNonEmptyString(p.max_section) ? p.max_section : undefined,
    signals:
      typeof p.signals === 'object' && p.signals !== null
        ? (p.signals as BeaconPayload['signals'])
        : undefined,
    target: isNonEmptyString(p.target) ? p.target.slice(0, 128) : undefined,
    href_host: isNonEmptyString(p.href_host) ? p.href_host.slice(0, 253) : undefined,
  };

  return { ok: true, payload };
}
