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
      const gear = bestEpicGearFor('rogue', spec) as Record<string, string>;
      // Twelve filled slots, and the two apex jewelry picks pinned by
      // IDENTITY: the re-pinned bands below are conditioned on exactly this
      // loadout (the OUTCOME note), so a picker or catalog change that swaps
      // either piece must red HERE with a gear message, never in a band with
      // a DPS message. ring2 is a three-way score-13 tie (abysswrought_band,
      // prismglass_loop, warhewn_signet) broken by the picker's id sort; this
      // identity pin is what makes that tie-break's stability a tested fact.
      expect(Object.keys(gear).length, `${spec} fills every slot`).toBe(12);
      expect(gear.neck, `${spec} neck is the apex pendant`).toBe('wyrmfall_pendant');
      expect(gear.ring2, `${spec} ring2 is the apex loop`).toBe('prismglass_loop');
      expect(
        Object.values(gear).every((itemId) => ITEMS[itemId]?.quality === 'epic'),
        `${spec} loadout excludes legendary gear`,
      ).toBe(true);
    }
  });

  it('holds Combat at the 200-DPS top band and pins the merged-tree sibling ordering', () => {
    const first = measuredDps();
    const repeat = measuredDps();
    expect(repeat).toEqual(first);

    // Accepted three-seed measurements on this fixture are approximately
    // 199.4 Combat, 170.4 Assassination, and 171.0 Subtlety. OUTCOME
    // (2026-08-16, Masterwrought phase 10 QA ruling 1, "accept the phase
    // design and re-pin"): the apex crafted jewelry (wyrmfall_pendant,
    // prismglass_loop) enters all three specs' derived BiS loadout on the
    // merged tree (identity-pinned in the fixture test above). The measured
    // MECHANISM: bestEpicGearFor's score() sums only item.stats, so
    // hit/crit/haste ratings are invisible to it (tests/dev_bis_gear.test.ts
    // states the same); the apex pieces win on an int-led raw stat bag
    // (neck int 8 + sta 6 = 14 over the displaced medallion's 12) while int
    // buys a rogue no throughput at all (rogue AP is str + agi), which is
    // also exactly why the fight measures LOWER: the fixture wears two
    // pieces no played rogue would equip (the score-vs-fight class the
    // phase 10 QA sync record flagged through the research memo's
    // Lionheart/Lariat precedent, first measured there). With the
    // masterwrought defs removed the picker restores the release loadout
    // and measures about 186.3 / 202.8 / 179.2 (assassination, combat,
    // subtlety), matching the release bands: that pre-apex baseline is
    // recorded here and in state.md for phase 15, which measures fights,
    // never scores. These bounds protect
    // the DEV-BIS FIXTURE's throughput (the suite's actual subject), not a
    // played rogue's. Assassination re-bands from the release's 180..195
    // to 165..180 around the measured 170.383. Subtlety's band is
    // UNCHANGED per the ruling, so its floor now sits a deliberate 1.0
    // under the measured 171.022, the tightest tripwire in the suite: a
    // sim change that moves subtlety down 0.6 percent reds it first, and
    // the measurement is deterministic, so that is a tripwire, never a
    // flake.
    expect(first.combat).toBeGreaterThanOrEqual(195);
    expect(first.combat).toBeLessThanOrEqual(205);
    expect(first.assassination).toBeGreaterThanOrEqual(165);
    expect(first.assassination).toBeLessThanOrEqual(180);
    expect(first.subtlety).toBeGreaterThanOrEqual(170);
    expect(first.subtlety).toBeLessThanOrEqual(185);
    // The ordering, restated to the merged-tree truth: Combat leads both
    // siblings, and Subtlety vs Assassination is a NEAR-TIE (0.639 apart,
    // 0.37 percent). The strict pair is a tie SENTINEL over a deterministic
    // measurement (a 0.1 flip is a real sim change worth a red), and the
    // band beside it states the actual design claim: the two siblings run
    // together. The two combat arms are entailed by the bands above and
    // stand as documentation of the lead, not as independent pins.
    expect(first.combat).toBeGreaterThan(first.subtlety);
    expect(first.combat).toBeGreaterThan(first.assassination);
    expect(first.subtlety).toBeGreaterThan(first.assassination);
    expect(Math.abs(first.subtlety - first.assassination)).toBeLessThanOrEqual(5);
  }, 30_000);
});
