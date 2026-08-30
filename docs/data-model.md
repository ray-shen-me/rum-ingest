# Firestore data model (task 2.1, design D5)

All collections are **flat, top-level collections** — the `→` below is *logical*
ownership, **not** Firestore subcollection nesting (design D5). Every document is
stamped with `site_id`; pageviews and events also carry `session_id`.

```
sites/{siteId}                     registry (seeded, task 2.2)
sessions/{siteId__sid}             one per visit (cookieless, D8)
pageviews/{siteId__pvid}           one per page load
events/{autoId | deterministic}    section_view + click (D11)
rollups/{siteId}/daily/{date}      per-site daily aggregates (D14) — a real subcollection
```

Why flat and not session-nested: the only raw access patterns are site+time
scans (the rollup job) and per-site rollup reads — never a session→children
drill-down. Flat collections make the site+day scan a single indexed query and
keep time-based retention deletes trivial (design D5, Scaling §2).

## Documents

### `sites/{siteId}`
| field | type | notes |
|---|---|---|
| `name` | string | display name, e.g. `"ray-shen.me"` |
| `sections` | string[] | **ordered** section slugs; drives funnel order & `max_section` resolution (D5) |

Seeded doc: `sites/ray-shen-me` → `{ name: "ray-shen.me", sections: ["hero","about","experience","projects","contact"] }`.

### `sessions/{siteId__sid}`
Doc id is `` `${site_id}__${session_id}` `` so a session upserts idempotently.

| field | type | notes |
|---|---|---|
| `session_id` | string | sessionStorage UUID (D8) |
| `site_id` | string | tenant dimension (D12) |
| `first_seen` / `last_seen` | Timestamp | first_seen written once (transaction) |
| `referrer_host` | string \| null | hostname only — query string discarded (D9) |
| `country` / `city` | string \| null | from GeoLite2; **raw IP never stored** (D6) |
| `device_type` | `mobile`\|`tablet`\|`desktop`\|`unknown` | derived from UA, UA discarded (D9) |
| `is_bot` / `bot_reason` | boolean / string \| null | tag, never filter (D7); sticky once true |
| `engaged_ms` | number | denormalized max across pageviews (D5) |
| `max_section` | string \| null | furthest section slug reached (D5) |

### `pageviews/{siteId__pvid}`
One per page load; in-tab reloads produce distinct `pvid`s (D5). Not written for bots (D7).

| field | type |
|---|---|
| `pageview_id`, `session_id`, `site_id`, `page` | string |
| `entered_at` | Timestamp |
| `engaged_ms` | number |
| `max_section` | string \| null |

### `events/{id}`
`type` discriminates `section_view` vs `click` (D11). Not written for bots (D7).

- **section_view** id is deterministic — `` `${site}__${pvid}__sv__${slug}` `` — so
  repeated flushes of the same section dedupe.
- **click** uses a Firestore auto-id (each click beacon is a distinct event).

| field | type | notes |
|---|---|---|
| `session_id`, `site_id`, `pageview_id` | string | |
| `type` | `section_view`\|`click` | |
| `target` | string | section slug, or click target id (`github`/`email`/`resume`/`linkedin`) |
| `href_host` | string \| null | click destination hostname (click only) |
| `at` | Timestamp | |

### `rollups/{siteId}/daily/{date}`
Per-site daily aggregate (D14). Split into `human` / `bot` so the metrics
endpoint can honor `include_bots` from a single doc. `date` is UTC `YYYY-MM-DD`.

```jsonc
{
  "date": "2026-08-29", "site_id": "ray-shen-me", "computed_at": <Timestamp>,
  "human": {
    "sessions": 42, "engaged_sessions": 30,
    "funnel":    { "hero": 42, "about": 33, "experience": 25, "projects": 18, "contact": 9 },
    "referrers": { "google.com": 20, "(direct)": 15 },
    "countries": { "US": 30, "DE": 5 },
    "clicks":    { "github": 12, "resume": 4, "linkedin": 3, "email": 2 }
  },
  "bot": { "sessions": 88, "referrers": { "linkedin.com": 40 }, "countries": { "US": 60 } }
}
```

## Aggregation (Firestore has no GROUP BY — H2)

Done in app code (`src/lib/aggregate.ts`), shared by the rollup job and the
metrics live-compute path. Queries are aligned with the composite indexes:

| query | index (task 2.3) |
|---|---|
| sessions for a (site, day) | `sessions`: `site_id` + `first_seen` |
| section_view / click events for a (site, day) | `events`: `site_id` + `type` + `at` |
| a session's events (drill-down / reclassification) | `events`: `session_id` + `type` |

- **Funnel** = distinct human sessions with a `section_view` for each section.
- **engaged_sessions** = human sessions with `engaged_ms >= ENGAGED_MS_THRESHOLD`
  (default 10 000 ms; configurable).
- **referrers/countries** = one contribution per session. Bots contribute to
  these only when `include_bots` is on.
- **clicks** = click-event counts (human only — bots write no events).
