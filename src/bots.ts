// Bot classification and UA-derived device type (design D7, D9).
//
// The raw user-agent is used transiently to (a) classify bots and (b) derive a
// coarse device_type, then DISCARDED — it is never persisted (D9).

import { isbot } from 'isbot';
import type { BeaconSignals } from './types.js';

export type DeviceType = 'mobile' | 'tablet' | 'desktop' | 'unknown';

/** Coarse device type from the UA string (D9 — store the class, discard the UA). */
export function deviceTypeFromUa(ua: string | undefined): DeviceType {
  if (!ua) return 'unknown';
  const s = ua.toLowerCase();
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(s)) return 'tablet';
  if (/mobi|iphone|ipod|android.*mobile|windows phone|blackberry/.test(s)) {
    return 'mobile';
  }
  if (/mozilla|chrome|safari|firefox|edge|opera|windows|macintosh|linux|x11/.test(s)) {
    return 'desktop';
  }
  return 'unknown';
}

export interface BotVerdict {
  is_bot: boolean;
  bot_reason: string | null;
}

/**
 * Classify a request as bot or not (D7), layering two signals:
 *   1. UA matching via `isbot` (crawlers + link-preview bots).
 *   2. Behavioral: no scroll, no pointer, single beacon, instant exit.
 *
 * The behavioral signals are only meaningful on a flush beacon; a start beacon
 * relies on UA alone. Behavioral detection is intentionally conservative to
 * avoid tagging fast human bounces as bots.
 */
export function classifyBot(
  ua: string | undefined,
  signals: BeaconSignals | undefined,
  engagedMs: number | undefined,
): BotVerdict {
  if (ua && isbot(ua)) {
    return { is_bot: true, bot_reason: 'ua' };
  }
  if (signals) {
    const noScroll = signals.scrolled === false;
    const noPointer = signals.pointer === false;
    const single = (signals.beacons ?? 0) <= 1;
    const instant = (engagedMs ?? 0) < 1000;
    if (noScroll && noPointer && single && instant) {
      return { is_bot: true, bot_reason: 'behavioral:no-interaction' };
    }
  }
  return { is_bot: false, bot_reason: null };
}
