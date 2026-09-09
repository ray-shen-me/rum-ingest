// Server-side geolocation from the client IP (design D6).
//
// The client IP is read transiently from X-Forwarded-For, looked up against a
// bundled MaxMind GeoLite2 City database (local file, no network call), reduced
// to country/city strings, and then DISCARDED. The raw IP is never stored.

import { Reader, type ReaderModel } from '@maxmind/geoip2-node';
import { readFileSync } from 'node:fs';
import { config } from './config.js';

let reader: ReaderModel | null = null;
let readerLoadFailed = false;

function getReader(): ReaderModel | null {
  if (reader) return reader;
  if (readerLoadFailed) return null;
  try {
    const buf = readFileSync(config.geoliteDbPath);
    reader = Reader.openBuffer(buf);
    return reader;
  } catch (err) {
    readerLoadFailed = true;
    console.warn(
      `[geo] GeoLite2 DB not loaded from ${config.geoliteDbPath}; geo will be null. ` +
        `(${(err as Error).message})`,
    );
    return null;
  }
}

/**
 * Extract the trusted client IP from an X-Forwarded-For header (M3).
 *
 * XFF is a client-appendable list; on Cloud Run the platform appends the real
 * client IP at a known position. We take that trusted position rather than
 * blindly trusting xff[0], or a client could spoof its geo. The position is
 * configurable (TRUSTED_XFF_POSITION) because it depends on the ingress path.
 */
export function clientIpFromXff(xff: string | undefined): string | null {
  if (!xff) return null;
  const parts = xff
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const pos = config.trustedXffPosition;
  if (pos === 'first') return parts[0] ?? null;
  if (pos === 'last') return parts[parts.length - 1] ?? null;

  const idxFromRight = Number(pos);
  if (Number.isInteger(idxFromRight) && idxFromRight >= 0) {
    return parts[parts.length - 1 - idxFromRight] ?? null;
  }
  return parts[parts.length - 1] ?? null;
}

export interface GeoResult {
  country: string | null;
  city: string | null;
}

/** Look up country/city for an IP. Returns nulls on miss or when the DB is absent. */
export function lookupGeo(ip: string | null): GeoResult {
  if (!ip) return { country: null, city: null };
  const r = getReader();
  if (!r) return { country: null, city: null };
  try {
    const res = r.city(ip);
    return {
      country: res.country?.isoCode ?? res.country?.names?.en ?? null,
      city: res.city?.names?.en ?? null,
    };
  } catch {
    // Address not found in DB, or private/invalid IP — geo simply unknown.
    return { country: null, city: null };
  }
}

/** Derive country/city directly from a request's XFF header, discarding the IP. */
export function geoFromXff(xff: string | undefined): GeoResult {
  const ip = clientIpFromXff(xff);
  return lookupGeo(ip);
  // `ip` goes out of scope here and is never persisted.
}
