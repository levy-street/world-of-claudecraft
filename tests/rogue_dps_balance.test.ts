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
    // 199.4 Combat, 170.4 Assassination, and 171.0 Subtlety. OUTCOME
    // (2026-08-16, Masterwrought phase 10 QA ruling 1, "accept the phase
    // design and re-pin"): the apex crafted jewelry (wyrmfall_pendant,
    // prismglass_loop) enters all three specs' derived BiS loadout on the
    // merged tree; its rating-heavy stat shape out-scores the raid pieces
    // in bestEpicGearFor's stats-sum picker while measuring lower in the
    // fight, so Assassination re-bands from the release's 180..195 to
    // 165..180 and the sibling ordering is restated to what the apex
    // jewelry yields: Combat strictly first, Subtlety marginally over
    // Assassination (171.02 vs 170.38). The bounds still protect the
    // player outcome while leaving a small deterministic tuning margin;
    // phase 15 measures fights, never scores.
    expect(first.combat).toBeGreaterThanOrEqual(195);
    expect(first.combat).toBeLessThanOrEqual(205);
    expect(first.assassination).toBeGreaterThanOrEqual(165);
    expect(first.assassination).toBeLessThanOrEqual(180);
    expect(first.subtlety).toBeGreaterThanOrEqual(170);
    expect(first.subtlety).toBeLessThanOrEqual(185);
    expect(first.combat).toBeGreaterThan(first.subtlety);
    expect(first.subtlety).toBeGreaterThan(first.assassination);
  }, 30_000);
});
