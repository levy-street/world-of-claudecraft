import { describe, expect, it } from 'vitest';
import {
  averageRogueDps,
  ROGUE_BAND_FIXTURE,
  type RogueProbeSpec,
  runRogueDpsProbe,
} from '../scripts/rogue_dps_probe';
import { ITEMS } from '../src/sim/data';

const SPECS: RogueProbeSpec[] = ['assassination', 'combat', 'subtlety'];

function measuredDps(): Record<RogueProbeSpec, number> {
  return Object.fromEntries(
    SPECS.map((spec) => [
      spec,
      averageRogueDps(
        spec,
        ROGUE_BAND_FIXTURE.seeds,
        ROGUE_BAND_FIXTURE.seconds,
        ROGUE_BAND_FIXTURE.targetArmor,
        ROGUE_BAND_FIXTURE.build,
      ).dps,
    ]),
  ) as Record<RogueProbeSpec, number>;
}

describe('Rogue fight-6498 deterministic DPS bands', () => {
  it('records the accepted La Luna, BiS epic, heroic Nythraxis fixture', () => {
    expect(ROGUE_BAND_FIXTURE).toEqual({
      seconds: 60,
      seeds: [4242, 777, 1313],
      targetArmor: 798,
      build: {
        row14: 'rog_r14_ceaseless_cuts',
        row20: 'rog_r20_second_shadow',
      },
      rows: {
        5: 'rog_r5_killers_pace',
        8: 'rog_r8_borrowed_breath',
        11: 'rog_r11_marked_prey',
        14: 'rog_r14_ceaseless_cuts',
        17: 'rog_r17_flurry_of_knives',
        20: 'rog_r20_second_shadow',
      },
    });

    // Assert the gear properties on what a probe run ACTUALLY equipped, not on
    // a picker function the probe could silently stop calling: re-coupling the
    // probe to the parse loadouts (legendaries included) fails here cheaply.
    for (const spec of SPECS) {
      const probe = runRogueDpsProbe(
        spec,
        ROGUE_BAND_FIXTURE.seeds[0],
        1,
        ROGUE_BAND_FIXTURE.targetArmor,
        ROGUE_BAND_FIXTURE.build,
      );
      const gear = Object.values(probe.equipment);
      expect(gear.length, `${spec} equips a complete representative loadout`).toBeGreaterThan(0);
      expect(
        gear.every((itemId) => ITEMS[itemId]?.quality === 'epic'),
        `${spec} probe loadout excludes legendary gear`,
      ).toBe(true);
    }
  });

  it('holds Combat at the 200-DPS top band and keeps the sibling ordering', () => {
    const first = measuredDps();
    const repeat = measuredDps();
    expect(repeat).toEqual(first);

    // Accepted three-seed measurements on this fixture are approximately
    // 202 Combat, 165 Assassination, and 177 Subtlety. Re-anchored twice:
    // first through the 2026-08-30 hit rebalance (the Crucible elective rings
    // traded their crit lines for Hit under the full-coverage program, and this
    // fixture fights SAME-LEVEL mobs where that hit is far past cap, so the
    // crit-for-hit trade is a real small loss here while the heroic +2 profile
    // gains it back and more), then through the poison-coating rework (issue
    // #3774): the probe runs Festering Venom, which traded a flat 14 per swing
    // for a stacking DoT worth about 10 dps at its 5-stack cap, so every spec
    // loses roughly 3 to 5% on this fixture. Both are deliberate rulings that
    // set a new power level; re-anchor to the measured values rather than
    // restoring an old band, and keep the sibling ordering pinned so a real
    // collapse still reds.
    expect(first.combat).toBeGreaterThanOrEqual(194);
    expect(first.combat).toBeLessThanOrEqual(210);
    expect(first.assassination).toBeGreaterThanOrEqual(157);
    expect(first.assassination).toBeLessThanOrEqual(173);
    expect(first.subtlety).toBeGreaterThanOrEqual(169);
    expect(first.subtlety).toBeLessThanOrEqual(185);
    expect(first.combat).toBeGreaterThan(first.subtlety);
    expect(first.subtlety).toBeGreaterThan(first.assassination);
  }, 30_000);
});
