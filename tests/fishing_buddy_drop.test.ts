// Crystal Tide: the one companion the water gives up.
//
// It is a SHARE of a landed catch, not a bonus beside one. A cast costs
// exactly one rng draw by contract (tests/professions_fishing.test.ts pins the
// bite-and-reel shape), so the whistle takes the bottom 0.5% of that same
// uniform and the table reads the rest of it unchanged. This file pins the
// three things that could silently go wrong: the rate drifting, the draw count
// growing (which would re-mint every catch sequence and every fishing golden),
// and the slice landing anything other than the whistle.

import { describe, expect, it } from 'vitest';
import { FISHING_TABLES_BY_BAND } from '../src/sim/content/items';
import { ITEMS } from '../src/sim/data';
import {
  buddyWhistlesOfQuality,
  FISHING_BUDDY_DROP,
  GLOBAL_BUDDY_DROP_TIERS,
} from '../src/sim/loot/global_drops';
import { completeFishing } from '../src/sim/professions/fishing';
import { Sim } from '../src/sim/sim';

const WHISTLE = FISHING_BUDDY_DROP.itemId;

/** Reel `n` times with the table draw forced to `u`, and report what landed.
 *  completeFishing is driven directly (no cast), so the ONLY draw in the loop
 *  is the one under test. */
function reelAt(u: number, n: number): { caught: string[]; draws: number } {
  const sim = new Sim({ seed: 11, playerClass: 'warrior' });
  const meta = sim.meta(sim.playerId);
  if (!meta) throw new Error('no player meta');
  let draws = 0;
  sim.rng.setObserver(() => draws++);
  const original = sim.rng.next.bind(sim.rng);
  sim.rng.next = () => {
    original();
    return u;
  };
  const caught: string[] = [];
  try {
    for (let i = 0; i < n; i++) {
      const before = sim.countItem(WHISTLE);
      completeFishing(sim.ctx, sim.player, meta);
      if (sim.countItem(WHISTLE) > before) caught.push(WHISTLE);
    }
  } finally {
    sim.rng.setObserver(null);
  }
  return { caught, draws };
}

describe('Crystal Tide, the fishing companion', () => {
  it('is declared at 0.5% of a catch, anywhere', () => {
    expect(FISHING_BUDDY_DROP.chance).toBe(0.005);
    expect(FISHING_BUDDY_DROP.itemId).toBe('whistle_crystal_tide');
    // Anywhere is the whole point: no zone or band is named here, and the
    // draw site reads the same constant for every table it resolves.
    expect(Object.keys(FISHING_BUDDY_DROP).sort()).toEqual(['chance', 'itemId']);
  });

  it('lands the whistle inside the slice and never outside it', () => {
    // Just inside: every reel hands over the whistle.
    const inside = reelAt(0.004, 5);
    expect(inside.caught).toEqual([WHISTLE, WHISTLE, WHISTLE, WHISTLE, WHISTLE]);
    // Just outside: the catch table answers instead, and never with a whistle.
    expect(reelAt(0.006, 5).caught).toEqual([]);
    // And far outside, across the rest of the uniform.
    for (const u of [0.05, 0.25, 0.5, 0.75, 0.999]) {
      expect(reelAt(u, 3).caught, `u=${u}`).toEqual([]);
    }
  });

  it('costs no extra draw: the slice rides the table draw itself', () => {
    // One reel, one draw, whether the whistle lands or a fish does. A second
    // chance() roll here would shift the whole fishing stream.
    expect(reelAt(0.004, 6).draws).toBe(6);
    expect(reelAt(0.6, 6).draws).toBe(6);
  });

  it('is not authored into any catch table, so no zone cell moved for it', () => {
    for (const band of FISHING_TABLES_BY_BAND) {
      for (const [zoneId, table] of Object.entries(band)) {
        expect(
          table.some((row) => row.itemId === WHISTLE),
          zoneId,
        ).toBe(false);
        // The cells still sum to their authored 100.
        expect(
          table.reduce((sum, row) => sum + row.weight, 0),
          zoneId,
        ).toBe(100);
      }
    }
  });

  it('never drops off a kill: fishing is its ONLY source', () => {
    expect(ITEMS[WHISTLE].quality).toBe('rare');
    // The rare tier is live for everything else in it (the three vendor
    // rares), so this cannot be read off the tier's rate: the pool itself has
    // to withhold the whistle, or any kill in the world would hand it over.
    const rare = GLOBAL_BUDDY_DROP_TIERS.find((tier) => tier.quality === 'rare');
    expect(rare?.chance).toBe(0.0005);
    expect(buddyWhistlesOfQuality('rare')).not.toContain(WHISTLE);
    // And it is in no other tier's pool either, however its quality is read.
    for (const tier of GLOBAL_BUDDY_DROP_TIERS) {
      expect(buddyWhistlesOfQuality(tier.quality), tier.quality).not.toContain(WHISTLE);
    }
    // The withholding is surgical: its own tier still pays out the rares that
    // do drop, so this is not a tier switched off.
    expect(buddyWhistlesOfQuality('rare').length).toBeGreaterThan(0);
  });

  it("is a whistle on the roster's ordinary terms otherwise", () => {
    expect(ITEMS[WHISTLE].kind).toBe('buddy');
    expect(ITEMS[WHISTLE].sellValue).toBe(50_000);
    expect(ITEMS[WHISTLE].soulbound).toBeUndefined();
    expect(ITEMS[WHISTLE].noDiscard).toBeUndefined();
  });
});
