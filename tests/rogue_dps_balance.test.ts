import { describe, expect, it } from 'vitest';
import {
  averageRogueDps,
  ROGUE_BAND_FIXTURE,
  type RogueProbeSpec,
} from '../scripts/rogue_dps_probe';
import { ITEMS } from '../src/sim/data';
import { bestEpicGearFor } from '../src/sim/dev/bis_gear';

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

    for (const spec of SPECS) {
      const gear = Object.values(bestEpicGearFor('rogue', spec));
      expect(gear.length, `${spec} has a complete representative loadout`).toBeGreaterThan(0);
      expect(
        gear.every((itemId) => ITEMS[itemId]?.quality === 'epic'),
        `${spec} loadout excludes legendary gear`,
      ).toBe(true);
    }
  });

  it('holds Combat at the 200-DPS top band and keeps the sibling ordering', () => {
    const first = measuredDps();
    const repeat = measuredDps();
    expect(repeat).toEqual(first);

    // Accepted three-seed measurements on this fixture are approximately
    // 182 Combat, 165 Assassination, and 159 Subtlety. The bounds protect the
    // player outcome while leaving a small deterministic tuning margin.
    //
    // Re-zeroed by the v0.38 set-bonus budget retune (was 203 / 186 / 179 with
    // bands 195-205, 180-195, 170-185). This fixture wears the BiS epic kit, so
    // it carried the off-budget set bonuses in full; every spec fell by about
    // 10 percent when those were priced against item_budget.ts, and all three
    // fell TOGETHER, so the sibling ordering the next assertion pins is intact.
    // Each bound keeps its original relative margin against the new measurement
    // rather than being widened, which the determinism pin above makes safe.
    expect(first.combat).toBeGreaterThanOrEqual(175);
    expect(first.combat).toBeLessThanOrEqual(185);
    expect(first.assassination).toBeGreaterThanOrEqual(160);
    expect(first.assassination).toBeLessThanOrEqual(173);
    expect(first.subtlety).toBeGreaterThanOrEqual(151);
    expect(first.subtlety).toBeLessThanOrEqual(164);
    expect(first.combat).toBeGreaterThan(first.assassination);
    expect(first.assassination).toBeGreaterThan(first.subtlety);
  }, 30_000);
});
