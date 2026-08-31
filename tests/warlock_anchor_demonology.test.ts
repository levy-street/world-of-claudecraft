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
// tripwire; demonology runs the hottest there because its undead neither miss
// a level-20 target nor meet any armor on the zero-armor shell. Both
// statistics are the probe harness's own four-seed mean, the same number the
// tuning study and the balance reports quote (a single seed wobbles a few
// points around it). One spec per file since the 2026-08-13 split, so the
// anchors spread across CI shards instead of sharing one file's wall clock.
const ANCHOR_SEEDS = [42, 1337, 9001, 777] as const;

describe('demonology 200 DPS anchors at 120 seconds', () => {
  it('lands on the 200 DPS heroic Nythraxis anchor with a healthy economy', () => {
    const rows = ANCHOR_SEEDS.map((seed) =>
      runWarlockBalanceProbe('demonology', seed, 120, WARLOCK_HEROIC_NYTHRAXIS_SCENARIO),
    );
    const mean = (key: 'dps' | 'starvedPct') =>
      rows.reduce((sum, row) => sum + row[key], 0) / rows.length;

    // Re-anchored for the 2/4/6 lineage retune: the frozen kit stacks both
    // old caster families, so it pays the halved lineage ladder now (about a
    // 12 to 15 percent drop from the 2026-08-23 anchors, the measured size of
    // the deliberate nerf). The historical 200 DPS figure was the OLD tier's
    // owner target, not a ceiling to restore: the Crucible wave introduces a
    // new power level, so when the Phase B set bonuses land
    // (docs/prd/ignivar-set-bonus-final.md), re-anchor these to whatever the
    // new-tier kit actually measures, above 200 included.
    // Re-anchored for the 2026-08-30 legendary band: the frozen kit wields
    // Deathless Heartwood, now budget-true at ilvl 49 (65 stats + 25 Spell
    // Power), measured 187.3 on the gate run; the band keeps its width.
    expect(mean('dps')).toBeGreaterThanOrEqual(178);
    expect(mean('dps')).toBeLessThanOrEqual(197);
    expect(mean('starvedPct')).toBeLessThan(0.1);
  }, 240_000);

  it('holds the level-20 dummy drift tripwire', () => {
    const rows = ANCHOR_SEEDS.map((seed) => runWarlockBalanceProbe('demonology', seed, 120));
    const mean = (key: 'dps' | 'starvedPct') =>
      rows.reduce((sum, row) => sum + row[key], 0) / rows.length;

    // 228.3 measured at the 2026-08-23 re-anchor (see the header note on why
    // the zero-armor dummy flatters undead); about plus or minus 5%, so the
    // tripwire trips on a real collapse or runaway, not on engine drift.
    // Post-retune measurement 210.7 (see the heroic anchor note above).
    expect(mean('dps')).toBeGreaterThanOrEqual(202);
    expect(mean('dps')).toBeLessThanOrEqual(226);
    expect(mean('starvedPct')).toBeLessThan(0.1);
  }, 240_000);
});
