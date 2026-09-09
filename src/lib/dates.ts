// UTC day helpers. All rollup/metric bucketing is by UTC calendar day (D14).

/** Format a Date as a UTC YYYY-MM-DD string. */
export function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Today's UTC date key. */
export function todayKey(now: Date = new Date()): string {
  return toDateKey(now);
}

/** Yesterday's UTC date key. */
export function yesterdayKey(now: Date = new Date()): string {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() - 1);
  return toDateKey(d);
}

/** Parse a YYYY-MM-DD key into the [start, end) UTC bounds of that day. */
export function dayBounds(dateKey: string): { start: Date; end: Date } {
  const start = new Date(`${dateKey}T00:00:00.000Z`);
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

/** Whether a date key is strictly before today's UTC day (i.e. a completed day). */
export function isCompletedDay(dateKey: string, now: Date = new Date()): boolean {
  return dateKey < todayKey(now);
}

/** Inclusive list of UTC date keys from `from` to `to`. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const cur = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cur.getTime() <= end.getTime()) {
    out.push(toDateKey(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** Validate a YYYY-MM-DD string. */
export function isValidDateKey(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && toDateKey(d) === s;
}

/** The N trailing completed day keys ending at yesterday (for backfill). */
export function trailingDays(count: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    const d = new Date(now.getTime());
    d.setUTCDate(d.getUTCDate() - i);
    out.push(toDateKey(d));
  }
  return out;
}
