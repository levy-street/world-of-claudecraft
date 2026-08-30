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
      const gear = probe.equipment as Record<string, string>;
      // Twelve filled slots, and the two jewelry picks pinned by IDENTITY on
      // what the probe ACTUALLY wore: the bands below are conditioned on
      // exactly this loadout (the OUTCOME note), so a picker or catalog
      // change that swaps either piece must red HERE with a gear message,
      // never in a band with a DPS message. Before the 2026-08-30
      // release/v0.41.0 sync merge this pinned the apex crafted pair
      // (neck wyrmfall_pendant, ring2 prismglass_loop, the latter a three-way
      // score-13 tie with abysswrought_band and warhewn_signet broken by the
      // picker's id sort). On the merged tree the release's Crucible raid
      // jewelry out-scores both on the raw stat bag (heartspring_amulet's
      // int 8 + spi 8 = 16 over the pendant's 14; circle_of_cinders takes
      // ring2 the same way), so the fixture now wears the raid pair and
      // NO masterwrought piece at all (tests/dev_bis_gear.test.ts pins the
      // same displacement per class). This pin re-anchors to that merged
      // truth so the mechanism survives: the next swap reds on gear first.
      expect(Object.keys(gear).length, `${spec} fills every slot`).toBe(12);
      expect(gear.neck, `${spec} neck is the Crucible amulet`).toBe('heartspring_amulet');
      expect(gear.ring2, `${spec} ring2 is the Crucible ring`).toBe('circle_of_cinders');
      expect(
        Object.values(gear).every((itemId) => ITEMS[itemId]?.quality === 'epic'),
        `${spec} probe loadout excludes legendary gear`,
      ).toBe(true);
    }
  });

  it('holds Combat at the 200-DPS top band and pins the merged-tree sibling ordering', () => {
    const first = measuredDps();
    const repeat = measuredDps();
    expect(repeat).toEqual(first);

    // Accepted three-seed measurements on this fixture are approximately
    // 199.4 Combat, 170.4 Assassination, and 171.0 Subtlety on this branch
    // before the 2026-08-30 release/v0.41.0 sync merge. OUTCOME
    // (2026-08-16, Masterwrought phase 10 QA ruling 1, "accept the phase
    // design and re-pin"): the apex crafted jewelry (wyrmfall_pendant,
    // prismglass_loop) entered all three specs' derived BiS loadout on that
    // day's tree (identity-pinned in the fixture test above until the
    // Crucible catalog displaced it, see below). The measured
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
    // subtlety), matching the release bands of that day: that pre-apex
    // baseline is recorded here and in state.md for phase 15, which
    // measures fights, never scores. These bounds protect the DEV-BIS
    // FIXTURE's throughput (the suite's actual subject), not a played
    // rogue's.
    //
    // The release side meanwhile re-anchored its own bands through the
    // 2026-08-30 hit rebalance (its measurements: 212 Combat, 175
    // Assassination, 190 Subtlety): the Crucible elective rings traded their
    // crit lines for Hit (full-coverage program), and this fixture fights
    // SAME-LEVEL mobs where that hit is far past cap, so the crit-for-hit
    // trade is a real small loss here (the classic farm-content shape) while
    // the heroic +2 profile gains it back and more. A new itemization ruling
    // sets a new power level; re-anchor to the measured values rather than
    // restoring an old band, and keep the sibling ordering pinned so a real
    // collapse still reds.
    //
    // MERGED TREE (2026-08-30 sync merge): the release's Crucible raid
    // catalog out-scores the apex crafted jewelry in the picker, so the apex
    // pair LEAVES the fixture loadout (the identity pin above records the
    // displacement) and the merged measurement lands exactly on the release's
    // figures: 211.8 Combat, 174.4 Assassination, 189.7 Subtlety. The bands
    // below are therefore the release's, re-derived on the merged tree
    // rather than copied; the pre-merge apex-loadout figures above stay as
    // the record of what this branch measured alone. The measurement is
    // deterministic, so a band edge is a tripwire, never a flake.
    expect(first.combat).toBeGreaterThanOrEqual(204);
    expect(first.combat).toBeLessThanOrEqual(220);
    expect(first.assassination).toBeGreaterThanOrEqual(167);
    expect(first.assassination).toBeLessThanOrEqual(183);
    expect(first.subtlety).toBeGreaterThanOrEqual(182);
    expect(first.subtlety).toBeLessThanOrEqual(198);
    // The ordering, restated to the merged-tree truth: Combat leads both
    // siblings, and Subtlety stays above Assassination (both parents pinned
    // the same three-way order; this branch's pre-merge near-tie band on the
    // sibling pair is retired by the release rebalance, which spreads them).
    // The strict pairs are a SENTINEL over a deterministic measurement (a
    // flip is a real sim change worth a red). The two combat arms are
    // entailed by the bands above and stand as documentation of the lead,
    // not as independent pins.
    expect(first.combat).toBeGreaterThan(first.subtlety);
    expect(first.combat).toBeGreaterThan(first.assassination);
    expect(first.subtlety).toBeGreaterThan(first.assassination);
  }, 30_000);
});
