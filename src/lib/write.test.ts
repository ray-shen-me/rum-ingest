// Unit tests for furthestSection — the funnel-advancement helper in write.ts.
// This is pure logic with no Firestore calls.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { furthestSection } from './write.js';

const ORDER = ['hero', 'about', 'experience', 'projects', 'contact'];

describe('furthestSection', () => {
  it('returns b when b is further along the order', () => {
    assert.equal(furthestSection(ORDER, 'hero', 'about'), 'about');
    assert.equal(furthestSection(ORDER, 'hero', 'projects'), 'projects');
  });

  it('returns a when a is further along the order', () => {
    assert.equal(furthestSection(ORDER, 'projects', 'hero'), 'projects');
    assert.equal(furthestSection(ORDER, 'contact', 'experience'), 'contact');
  });

  it('returns a when both are equal', () => {
    assert.equal(furthestSection(ORDER, 'about', 'about'), 'about');
  });

  it('returns b when a is null', () => {
    assert.equal(furthestSection(ORDER, null, 'about'), 'about');
  });

  it('returns a when b is null', () => {
    assert.equal(furthestSection(ORDER, 'about', null), 'about');
  });

  it('returns null when both are null', () => {
    assert.equal(furthestSection(ORDER, null, null), null);
  });

  it('returns null when b is undefined', () => {
    assert.equal(furthestSection(ORDER, null, undefined), null);
  });

  it('returns a when b is unknown slug (not in order)', () => {
    // indexOf returns -1 for unknown; -1 < any valid index, so a wins
    assert.equal(furthestSection(ORDER, 'about', 'unknown-section'), 'about');
  });
});
