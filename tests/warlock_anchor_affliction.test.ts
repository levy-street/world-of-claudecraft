import { describe, expect, it } from 'vitest';
import { runWarlockBalanceProbe } from '../scripts/warlock_balance_probe';

// The sub-200 anchor gate (owner ruling, 2026-08-06): every warlock spec lands
// at or under 200 DPS at 120 seconds in full BiS (no legendary is equippable by
// a warlock), with a healthy two-minute economy: the mana cliff belongs to the
// five-minute windows (tests/warlock_five_minute_windows.test.ts), never inside
// the first two minutes. Measured as the probe harness's own four-seed mean,
// the same statistic the tuning study and the balance reports quote (a single
// seed wobbles a few points around it). One spec per file since the 2026-08-13
// split, so the three anchors spread across CI shards instead of sharing one
// file's wall clock.
const ANCHOR_SEEDS = [42, 1337, 9001, 777] as const;

describe('warlock sub-200 BiS anchor at 120 seconds', () => {
  it.each(['affliction'] as const)(
    '%s stays at or under the 200 DPS anchor with a healthy two-minute economy',
    (spec) => {
      const rows = ANCHOR_SEEDS.map((seed) => runWarlockBalanceProbe(spec, seed, 120));
      const mean = (key: 'dps' | 'starvedPct') =>
        rows.reduce((sum, row) => sum + row[key], 0) / rows.length;

      expect(mean('dps')).toBeLessThanOrEqual(200);
      // Floor 150 to 140 with the 2026-08-07 top-end trim round: the isolated
      // head benches below the composed tree, and the sanctioned cuts land
      // Ruination and Pactbound near 148-149 here. The floor still catches a
      // collapse; the anchor above is the load-bearing half.
      expect(mean('dps')).toBeGreaterThanOrEqual(140);
      expect(mean('starvedPct')).toBeLessThan(0.1);
    },
    180_000,
  );
});
