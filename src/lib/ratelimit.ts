// Per-IP rate limit backstop for /track (design D7, task 3.3).
//
// This is an in-memory fixed-window counter. On Cloud Run it is per-instance,
// so it is a backstop against a single noisy client hammering one instance —
// not a global quota. That is exactly the role D7 assigns it. Bot write-capping
// (a single session doc per bot) is the primary quota protection.

import { config } from '../config.js';

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

export function allow(ip: string | null): boolean {
  if (!ip) return true; // Can't identify — don't block; validation still applies.
  const now = Date.now();
  const w = windows.get(ip);
  if (!w || now >= w.resetAt) {
    windows.set(ip, { count: 1, resetAt: now + config.rateLimitWindowMs });
    return true;
  }
  w.count += 1;
  return w.count <= config.rateLimitMax;
}

// Opportunistic cleanup so the map can't grow unbounded on a long-lived instance.
setInterval(() => {
  const now = Date.now();
  for (const [ip, w] of windows) {
    if (now >= w.resetAt) windows.delete(ip);
  }
}, 60_000).unref();
