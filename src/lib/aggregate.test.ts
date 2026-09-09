// Unit tests for the pure merge helpers in aggregate.ts.
// aggregateDay itself requires Firestore — tested via integration later.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeHuman, mergeBot, emptyHuman } from './aggregate.js';
import type { HumanAggregate, BotAggregate } from '../types.js';

function makeHuman(overrides: Partial<HumanAggregate> = {}): HumanAggregate {
  return {
    ...emptyHuman(),
    ...overrides,
  };
}

function makeBot(overrides: Partial<BotAggregate> = {}): BotAggregate {
  return { sessions: 0, referrers: {}, countries: {}, ...overrides };
}

describe('emptyHuman', () => {
  it('returns zero-valued aggregate', () => {
    const h = emptyHuman();
    assert.equal(h.sessions, 0);
    assert.equal(h.engaged_sessions, 0);
    assert.deepEqual(h.funnel, {});
    assert.deepEqual(h.referrers, {});
    assert.deepEqual(h.countries, {});
    assert.deepEqual(h.clicks, {});
  });
});

describe('mergeHuman', () => {
  it('accumulates session counts', () => {
    const into = makeHuman({ sessions: 3, engaged_sessions: 1 });
    const from = makeHuman({ sessions: 2, engaged_sessions: 2 });
    mergeHuman(into, from);
    assert.equal(into.sessions, 5);
    assert.equal(into.engaged_sessions, 3);
  });

  it('merges funnel counts', () => {
    const into = makeHuman({ funnel: { hero: 10, about: 5 } });
    const from = makeHuman({ funnel: { hero: 3, projects: 2 } });
    mergeHuman(into, from);
    assert.equal(into.funnel['hero'], 13);
    assert.equal(into.funnel['about'], 5);
    assert.equal(into.funnel['projects'], 2);
  });

  it('merges referrer counts', () => {
    const into = makeHuman({ referrers: { 'google.com': 4 } });
    const from = makeHuman({ referrers: { 'google.com': 2, 'github.com': 1 } });
    mergeHuman(into, from);
    assert.equal(into.referrers['google.com'], 6);
    assert.equal(into.referrers['github.com'], 1);
  });

  it('merges country counts', () => {
    const into = makeHuman({ countries: { US: 10, CA: 3 } });
    const from = makeHuman({ countries: { US: 5, GB: 2 } });
    mergeHuman(into, from);
    assert.equal(into.countries['US'], 15);
    assert.equal(into.countries['CA'], 3);
    assert.equal(into.countries['GB'], 2);
  });

  it('merges click counts', () => {
    const into = makeHuman({ clicks: { github: 3 } });
    const from = makeHuman({ clicks: { github: 1, resume: 2 } });
    mergeHuman(into, from);
    assert.equal(into.clicks['github'], 4);
    assert.equal(into.clicks['resume'], 2);
  });

  it('merging empty from leaves into unchanged', () => {
    const into = makeHuman({ sessions: 5, funnel: { hero: 3 } });
    const from = makeHuman();
    mergeHuman(into, from);
    assert.equal(into.sessions, 5);
    assert.equal(into.funnel['hero'], 3);
  });
});

describe('mergeBot', () => {
  it('adds bot session count to human sessions', () => {
    const into = makeHuman({ sessions: 10 });
    const bot = makeBot({ sessions: 4 });
    mergeBot(into, bot);
    assert.equal(into.sessions, 14);
  });

  it('merges bot referrers into human referrers', () => {
    const into = makeHuman({ referrers: { 'google.com': 2 } });
    const bot = makeBot({ referrers: { 'google.com': 1, 'bot.com': 5 } });
    mergeBot(into, bot);
    assert.equal(into.referrers['google.com'], 3);
    assert.equal(into.referrers['bot.com'], 5);
  });

  it('merges bot countries into human countries', () => {
    const into = makeHuman({ countries: { US: 5 } });
    const bot = makeBot({ countries: { US: 2, RU: 3 } });
    mergeBot(into, bot);
    assert.equal(into.countries['US'], 7);
    assert.equal(into.countries['RU'], 3);
  });

  it('does not touch funnel or clicks (bots have no events)', () => {
    const into = makeHuman({ funnel: { hero: 10 }, clicks: { github: 2 } });
    const bot = makeBot({ sessions: 99 });
    mergeBot(into, bot);
    assert.equal(into.funnel['hero'], 10);
    assert.equal(into.clicks['github'], 2);
    assert.equal(into.engaged_sessions, 0);
  });
});
