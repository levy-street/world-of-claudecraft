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

    // Prior anchor: ~212 Combat, 175 Assassination, 190 Subtlety (2026-08-30
    // hit rebalance, this branch's own Crucible-loadout baseline). Two moves
    // land on top of it in THIS merge, both from the OSSBrain candidate side:
    // the poison-coating rework lowers this same-level fixture's sustained
    // output, and v0.42.0 class balance (docs/design/class-balance-v042.md)
    // buffs Knifework/assassination (+9.89%) and nerfs Skulduggery/subtlety's
    // sustained output (-12.50%, this fixture's "generic rogue policy" row);
    // combat is untuned by the rebalance but still moves under the coating
    // rework. MEASURED on the merged tree (never fabricated): three-seed
    // averages land at approximately 203.1 Combat, 181.8 Assassination, and
    // 152.7 Subtlety, which is what the bounds below anchor to. The
    // rebalance's two moves cross the sibling order, so the ordering
    // assertion re-anchors to combat > assassination > subtlety.
    expect(first.combat).toBeGreaterThanOrEqual(195);
    expect(first.combat).toBeLessThanOrEqual(211);
    expect(first.assassination).toBeGreaterThanOrEqual(174);
    expect(first.assassination).toBeLessThanOrEqual(190);
    expect(first.subtlety).toBeGreaterThanOrEqual(145);
    expect(first.subtlety).toBeLessThanOrEqual(161);
    expect(first.combat).toBeGreaterThan(first.assassination);
    expect(first.assassination).toBeGreaterThan(first.subtlety);
  }, 30_000);
});
