import { describe, expect, it } from 'vitest';
import { ALL_RECIPES, TROPHY_RECIPES } from '../../src/sim/content/recipes';
import { ITEMS } from '../../src/sim/data';
import type { ItemDef } from '../../src/sim/types';
import { adoptedTrophyIds } from './adopted_trophy_ids';

// The paired test for the shared adopted-trophy derivation. The three consumer
// suites each hold their own literal equal to its output, so the helper's
// contract is pinned here once: the live catalog answers the nine adopted
// trophies exactly, and each of the two filters (junk kind, no second
// consumer) is proven to be live by a case that would pass without it.

describe('adoptedTrophyIds', () => {
  // The nine Masterwrought phase 11l adoptions: seven promoted from poor plus
  // the two already-common leather trophies the second review round adopted.
  // The chipped tusk is absent since the sixth fix round output-excluded it
  // (src/sim/content/recipes.ts, the 11l-RUNG EXCLUSION RECORD).
  const ADOPTED = [
    'bandit_bandana',
    'bogiron_nugget',
    'cracked_fetish',
    'cracked_ogre_tusk',
    'cracked_wyrm_scale',
    'emberwing_cinderscale',
    'mudfin_scale',
    'old_cragmaws_pelt',
    'tallow_candle',
  ];

  it('derives exactly the nine adopted trophies from the live catalog, sorted', () => {
    expect(ADOPTED).toHaveLength(9);
    expect(adoptedTrophyIds(ITEMS)).toEqual(ADOPTED);
  });

  it('excludes a reagent whose def is not junk-kind (the kind filter is live)', () => {
    // The same trophy row, the same reagent line, only the def's kind moved:
    // a bandana re-kinded as a tool (the fishing pole's def under the
    // bandana's id, the tests/material_taxonomy.test.ts probe shape, since
    // ItemDef discriminates on kind and a spread cannot re-kind a junk def)
    // leaves the derived set while every other adoption stays put, which is
    // what proves the filter reads KIND rather than recipe membership.
    const synthetic: Record<string, ItemDef> = {
      ...ITEMS,
      bandit_bandana: {
        ...ITEMS.simple_fishing_pole,
        id: 'bandit_bandana',
        name: ITEMS.bandit_bandana.name,
      },
    };
    expect(synthetic.bandit_bandana.kind).not.toBe('junk');
    expect(adoptedTrophyIds(synthetic)).toEqual(ADOPTED.filter((id) => id !== 'bandit_bandana'));
  });

  it('excludes a junk-kind reagent another recipe also consumes (the shared filter is live)', () => {
    // iron_ore is junk-kind and sits on a trophy bill (recipe_hobnail_boots),
    // so the kind filter alone would admit it; the shared filter is what keeps
    // it out, because the ladder rungs consume it too. Stated against the
    // live catalog so the premise (junk kind, on a trophy bill, shared) is
    // checked rather than assumed.
    const consumes = (recipes: typeof ALL_RECIPES): boolean =>
      recipes.some((r) => r.reagents.some((g) => g.itemId === 'iron_ore'));
    expect(ITEMS.iron_ore.kind).toBe('junk');
    expect(consumes(TROPHY_RECIPES)).toBe(true);
    const trophyIds = new Set(TROPHY_RECIPES.map((r) => r.id));
    expect(consumes(ALL_RECIPES.filter((r) => !trophyIds.has(r.id)))).toBe(true);
    expect(adoptedTrophyIds(ITEMS)).not.toContain('iron_ore');
  });
});
