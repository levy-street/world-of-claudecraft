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
    // 203 Combat, 186 Assassination, and 179 Subtlety. The bounds protect the
    // player outcome while leaving a small deterministic tuning margin.
    expect(first.combat).toBeGreaterThanOrEqual(195);
    expect(first.combat).toBeLessThanOrEqual(205);
    expect(first.assassination).toBeGreaterThanOrEqual(180);
    expect(first.assassination).toBeLessThanOrEqual(195);
    expect(first.subtlety).toBeGreaterThanOrEqual(170);
    expect(first.subtlety).toBeLessThanOrEqual(185);
    expect(first.combat).toBeGreaterThan(first.assassination);
    expect(first.assassination).toBeGreaterThan(first.subtlety);
  }, 30_000);
});
