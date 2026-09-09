// Shared contract types for rum-ingest.
//
// This file is the single source of truth for:
//   - the beacon payload the tracker POSTs to /track  (consumed by rum tracker)
//   - the Firestore document shapes                    (design D5)
//   - the /metrics response                            (consumed by rum-dashboard)
//
// Per design D15 these types are duplicated (not imported) by the tracker and
// dashboard repos; keep the three copies in sync when the contract changes.

/** Event types carried on `events` docs (D5, D11). */
export type EventType = 'section_view' | 'click';

/** Beacon kinds the tracker sends (D3, D4, D11). */
export type BeaconType = 'pageview' | 'flush' | 'click';

/** Behavioral signals the client reports, used for bot detection (D7). */
export interface BeaconSignals {
  /** Did any scroll happen during the visit? */
  scrolled?: boolean;
  /** Did any pointer/touch/keyboard interaction happen? */
  pointer?: boolean;
  /** How many beacons this page has sent so far (1 = single-beacon visit). */
  beacons?: number;
}

/**
 * The beacon payload. Sent as a `text/plain` body (a JSON string) so the
 * cross-origin `sendBeacon` stays a CORS "simple request" with no preflight
 * (design D2). All fields except the identifiers are optional and depend on `t`.
 */
export interface BeaconPayload {
  /** Site key from the tracker's `data-site` attribute (D12). Not a secret (D9a). */
  site: string;
  /** Session UUID from sessionStorage — cookieless, fresh per visit (D8). */
  sid: string;
  /** Pageview UUID — fresh per page load, so reloads are distinct pageviews (D5). */
  pvid: string;
  /** Beacon kind. */
  t: BeaconType;
  /** Pathname of the page (e.g. "/"). */
  page: string;

  /** Raw referrer (start beacon only). Ingest reduces this to a hostname (D9). */
  ref?: string;

  // --- flush beacon ---
  /** Accumulated visible/engaged time in ms (D3). */
  engaged_ms?: number;
  /** Section slugs first seen this pageview, batched (D11). */
  sections?: string[];
  /** Furthest section slug reached this pageview (D5). */
  max_section?: string;
  /** Behavioral signals for bot detection (D7). */
  signals?: BeaconSignals;

  // --- click beacon ---
  /** Click target identifier, e.g. "github" | "email" | "resume" | "linkedin". */
  target?: string;
  /** Hostname of the click destination, if outbound (D9 — hostname only). */
  href_host?: string;
}

// --- Firestore documents (design D5) ---

export interface SessionDoc {
  session_id: string;
  site_id: string;
  first_seen: FirebaseFirestore.Timestamp;
  last_seen: FirebaseFirestore.Timestamp;
  referrer_host: string | null;
  country: string | null;
  city: string | null;
  device_type: 'mobile' | 'tablet' | 'desktop' | 'unknown';
  is_bot: boolean;
  bot_reason: string | null;
  /** Denormalized session-level engaged time (max across pageviews) — D5. */
  engaged_ms: number;
  /** Denormalized furthest section slug reached in the session (D5). */
  max_section: string | null;
}

export interface PageviewDoc {
  pageview_id: string;
  session_id: string;
  site_id: string;
  page: string;
  entered_at: FirebaseFirestore.Timestamp;
  engaged_ms: number;
  max_section: string | null;
}

export interface EventDoc {
  session_id: string;
  site_id: string;
  pageview_id: string;
  type: EventType;
  /** For section_view: the section slug. For click: the click target id. */
  target: string;
  /** Click destination hostname (click events only). */
  href_host: string | null;
  at: FirebaseFirestore.Timestamp;
}

export interface SiteDoc {
  name: string;
  /** Ordered section slugs — funnel order & max_section resolution (D5). */
  sections: string[];
}

// --- Rollup document (design D14) ---
// Split by human/bot so the metrics endpoint can honor the include_bots toggle
// from a single rollup doc. Bots have no event docs (D7), so bot aggregates
// carry only session-derived dimensions.

export interface HumanAggregate {
  sessions: number;
  engaged_sessions: number;
  /** Per-section reach: distinct sessions that reached each section slug. */
  funnel: Record<string, number>;
  /** referrer host -> session count. */
  referrers: Record<string, number>;
  /** country -> session count. */
  countries: Record<string, number>;
  /** click target -> event count. */
  clicks: Record<string, number>;
}

export interface BotAggregate {
  sessions: number;
  referrers: Record<string, number>;
  countries: Record<string, number>;
}

export interface DayAggregate {
  date: string; // YYYY-MM-DD (UTC)
  site_id: string;
  human: HumanAggregate;
  bot: BotAggregate;
}

export interface RollupDoc extends DayAggregate {
  computed_at: FirebaseFirestore.Timestamp;
}

// --- /metrics response (consumed by rum-dashboard) ---

export interface MetricsDay {
  date: string;
  sessions: number;
  engaged_sessions: number;
  bot_sessions: number;
  human_sessions: number;
  funnel: Record<string, number>;
  referrers: Record<string, number>;
  countries: Record<string, number>;
  clicks: Record<string, number>;
  /** True when this day was computed live from raw docs rather than a rollup. */
  live: boolean;
}

export interface MetricsResponse {
  site_id: string;
  range: { from: string; to: string };
  include_bots: boolean;
  sections_order: string[];
  days: MetricsDay[];
  totals: {
    sessions: number;
    engaged_sessions: number;
    bot_sessions: number;
    human_sessions: number;
    funnel: Record<string, number>;
    referrers: Record<string, number>;
    countries: Record<string, number>;
    clicks: Record<string, number>;
  };
}
