// Local/manual rollup runner (task 5.5 helper).
//
// Usage:
//   npm run rollup:local                 # yesterday + backfill window
//   npm run rollup:local -- 2026-08-29   # a specific day
//   npm run rollup:local -- 2026-08-01 2026-08-29   # an inclusive range
//
// Runs the same aggregation code the scheduled endpoint uses, against ADC creds.

import { runRollup } from '../src/lib/rollup.js';
import { dateRange, isValidDateKey } from '../src/lib/dates.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter(Boolean);
  let dates: string[] | undefined;

  if (args.length === 1 && isValidDateKey(args[0]!)) {
    dates = [args[0]!];
  } else if (args.length === 2 && isValidDateKey(args[0]!) && isValidDateKey(args[1]!)) {
    dates = dateRange(args[0]!, args[1]!);
  } else if (args.length > 0) {
    console.error('Usage: run-rollup.ts [YYYY-MM-DD] | [FROM TO]');
    process.exit(1);
  }

  const result = await runRollup({ dates, backfill: !dates });
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Rollup failed:', err);
    process.exit(1);
  });
