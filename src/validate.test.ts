// Unit tests for parseBeacon — the public validation boundary.
// Uses Node.js built-in test runner (node:test) + tsx for TypeScript.
// No Firestore / Firebase calls are made: parseBeacon is pure.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseBeacon } from './validate.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const base = {
  site: 'ray-shen-me',
  sid: 'sess-abc',
  pvid: 'pv-123',
  t: 'pageview',
  page: '/',
} as const;

// ---------------------------------------------------------------------------
// Valid beacons
// ---------------------------------------------------------------------------

describe('parseBeacon — valid beacons', () => {
  it('accepts a minimal pageview beacon', () => {
    const r = parseBeacon({ ...base });
    assert.ok(r.ok);
    assert.equal(r.payload?.t, 'pageview');
    assert.equal(r.payload?.site, 'ray-shen-me');
    assert.equal(r.payload?.page, '/');
  });

  it('accepts a flush beacon with sections and max_section', () => {
    const r = parseBeacon({
      ...base,
      t: 'flush',
      engaged_ms: 5000,
      sections: ['hero', 'about'],
      max_section: 'about',
    });
    assert.ok(r.ok);
    assert.equal(r.payload?.t, 'flush');
    assert.deepEqual(r.payload?.sections, ['hero', 'about']);
    assert.equal(r.payload?.max_section, 'about');
    assert.equal(r.payload?.engaged_ms, 5000);
  });

  it('accepts a click beacon with target and href_host', () => {
    const r = parseBeacon({
      ...base,
      t: 'click',
      target: 'github',
      href_host: 'github.com',
    });
    assert.ok(r.ok);
    assert.equal(r.payload?.t, 'click');
    assert.equal(r.payload?.target, 'github');
    assert.equal(r.payload?.href_host, 'github.com');
  });

  it('parses a JSON string body (sendBeacon text/plain path)', () => {
    const r = parseBeacon(JSON.stringify({ ...base }));
    assert.ok(r.ok);
    assert.equal(r.payload?.t, 'pageview');
  });

  it('accepts beacon without optional fields', () => {
    const r = parseBeacon({ ...base });
    assert.ok(r.ok);
    assert.equal(r.payload?.ref, undefined);
    assert.equal(r.payload?.engaged_ms, undefined);
    assert.equal(r.payload?.sections, undefined);
    assert.equal(r.payload?.max_section, undefined);
  });
});

// ---------------------------------------------------------------------------
// Missing required fields
// ---------------------------------------------------------------------------

describe('parseBeacon — missing required fields', () => {
  it('rejects missing site', () => {
    const { site: _, ...rest } = base;
    const r = parseBeacon(rest);
    assert.ok(!r.ok);
    assert.match(r.error ?? '', /site/);
  });

  it('rejects empty site string', () => {
    const r = parseBeacon({ ...base, site: '' });
    assert.ok(!r.ok);
  });

  it('rejects missing sid', () => {
    const { sid: _, ...rest } = base;
    const r = parseBeacon(rest);
    assert.ok(!r.ok);
    assert.match(r.error ?? '', /sid/);
  });

  it('rejects missing pvid', () => {
    const { pvid: _, ...rest } = base;
    const r = parseBeacon(rest);
    assert.ok(!r.ok);
    assert.match(r.error ?? '', /pvid/);
  });

  it('rejects missing page', () => {
    const { page: _, ...rest } = base;
    const r = parseBeacon(rest);
    assert.ok(!r.ok);
    assert.match(r.error ?? '', /page/);
  });

  it('rejects unknown beacon type', () => {
    const r = parseBeacon({ ...base, t: 'unknown' });
    assert.ok(!r.ok);
    assert.match(r.error ?? '', /beacon type/);
  });

  it('rejects click beacon missing target', () => {
    const r = parseBeacon({ ...base, t: 'click' });
    assert.ok(!r.ok);
    assert.match(r.error ?? '', /target/);
  });
});

// ---------------------------------------------------------------------------
// Malformed bodies
// ---------------------------------------------------------------------------

describe('parseBeacon — malformed bodies', () => {
  it('rejects invalid JSON string', () => {
    const r = parseBeacon('not json{');
    assert.ok(!r.ok);
    assert.match(r.error ?? '', /JSON/);
  });

  it('rejects null body', () => {
    const r = parseBeacon(null);
    assert.ok(!r.ok);
  });

  it('rejects array body', () => {
    const r = parseBeacon([base]);
    assert.ok(!r.ok);
  });
});

// ---------------------------------------------------------------------------
// Bounding / sanitisation
// ---------------------------------------------------------------------------

describe('parseBeacon — bounding', () => {
  it('caps engaged_ms at 86_400_000', () => {
    const r = parseBeacon({ ...base, engaged_ms: 999_999_999 });
    assert.ok(r.ok);
    assert.equal(r.payload?.engaged_ms, 86_400_000);
  });

  it('ignores negative engaged_ms', () => {
    const r = parseBeacon({ ...base, engaged_ms: -1 });
    assert.ok(r.ok);
    assert.equal(r.payload?.engaged_ms, undefined);
  });

  it('truncates sections array to 50 items', () => {
    const sections = Array.from({ length: 60 }, (_, i) => `s${i}`);
    const r = parseBeacon({ ...base, t: 'flush', sections });
    assert.ok(r.ok);
    assert.equal(r.payload?.sections?.length, 50);
  });

  it('filters non-string items from sections', () => {
    const r = parseBeacon({ ...base, t: 'flush', sections: ['hero', 42, null, 'about'] });
    assert.ok(r.ok);
    assert.deepEqual(r.payload?.sections, ['hero', 'about']);
  });

  it('truncates page to 512 chars', () => {
    const r = parseBeacon({ ...base, page: 'a'.repeat(600) });
    assert.ok(r.ok);
    assert.equal(r.payload?.page.length, 512);
  });

  it('truncates ref to 2048 chars', () => {
    const r = parseBeacon({ ...base, ref: 'https://example.com/' + 'a'.repeat(2100) });
    assert.ok(r.ok);
    assert.equal(r.payload?.ref?.length, 2048);
  });

  it('omits max_section when empty string', () => {
    const r = parseBeacon({ ...base, max_section: '' });
    assert.ok(r.ok);
    assert.equal(r.payload?.max_section, undefined);
  });
});
