import { describe, expect, it } from 'vitest';
import {
  runWarlockBalanceProbe,
  WARLOCK_HEROIC_NYTHRAXIS_SCENARIO,
} from '../scripts/warlock_balance_probe';

// The 200 heroic anchor (owner directive, 2026-08-23 PVE viability round):
// each warlock spec converges on about 200 DPS at 120 seconds against the
// heroic Nythraxis profile (level-22 target wearing the real Nythraxis armor
// curve) in the re-anchored best real kit, the fix for live heroic parse tops
// of 169/133/131 while combat and fire topped 217 to 222. This supersedes the
// 2026-08-06 sub-200 ruling, which was minted on a zero-armor level-20 dummy
// and a fixture kit that forfeited both caster set bonuses and most hit
// rating. The level-20 dummy stays pinned below as the historical drift
// tripwire. Both statistics are the probe harness's own four-seed mean, the
// same number the tuning study and the balance reports quote (a single seed
// wobbles a few points around it). One spec per file since the 2026-08-13
// split, so the anchors spread across CI shards instead of sharing one
// file's wall clock.
const ANCHOR_SEEDS = [42, 1337, 9001, 777] as const;

describe('affliction 200 DPS anchors at 120 seconds', () => {
  it('lands on the 200 DPS heroic Nythraxis anchor with a healthy economy', () => {
    const rows = ANCHOR_SEEDS.map((seed) =>
      runWarlockBalanceProbe('affliction', seed, 120, WARLOCK_HEROIC_NYTHRAXIS_SCENARIO),
    );
    const mean = (key: 'dps' | 'starvedPct') =>
      rows.reduce((sum, row) => sum + row[key], 0) / rows.length;

    expect(mean('dps')).toBeGreaterThanOrEqual(185);
    expect(mean('dps')).toBeLessThanOrEqual(220);
    expect(mean('starvedPct')).toBeLessThan(0.1);
  }, 240_000);

  it('holds the level-20 dummy drift tripwire', () => {
    const rows = ANCHOR_SEEDS.map((seed) => runWarlockBalanceProbe('affliction', seed, 120));
    const mean = (key: 'dps' | 'starvedPct') =>
      rows.reduce((sum, row) => sum + row[key], 0) / rows.length;

    // 208.8 measured at the 2026-08-23 re-anchor; about plus or minus 5%, so
    // the tripwire trips on a real collapse or runaway, not on engine drift.
    expect(mean('dps')).toBeGreaterThanOrEqual(198);
    expect(mean('dps')).toBeLessThanOrEqual(219);
    expect(mean('starvedPct')).toBeLessThan(0.1);
  }, 240_000);
});
