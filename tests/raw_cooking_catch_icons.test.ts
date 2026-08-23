// Procedural icon recipes for raw cooking catches: after leaving kind food they
// must still resolve a fish-like recipe, never the generic junk trinket
// fallback. Static WebP art remains the preferred runtime path; this pins the
// compositor recipe unit-testably without a canvas.

import { describe, expect, it } from 'vitest';
import { RAW_COOKING_CATCH_IDS } from '../src/sim/content/items';
import { ITEMS } from '../src/sim/data';
import { itemIconRecipe } from '../src/ui/icons';

describe('raw cooking catch icon recipes', () => {
  it('every catch is kind junk and still maps to the fish fallback shape', () => {
    // Hand-authored trout uses a custom droplet+fang fish silhouette; every
    // other catch must hit the shared fish fallback (bg drink / pal sky /
    // prim fish). A loose fish|droplet|fang set is too weak: trinket scale
    // maps to droplet and would hide a dead fallback arm.
    // TEN since masterwrought Phase 11i's three high-band catches. The three
    // new ids carry EXPLICIT icon recipes rather than the fish fallback (their
    // art is parked, and a parked id must serve a distinct drawn icon), so the
    // fallback-shape assertion below is scoped to the rows that still take it.
    expect(RAW_COOKING_CATCH_IDS.size).toBe(10);
    // The three high-band catches carry HAND-AUTHORED rows like the trout, and
    // for a mechanical reason rather than taste: their art is parked, and a
    // parked id must serve a DISTINCT drawn icon (the A4 sweep in
    // tests/item_icons.test.ts), which the one shared fish fallback cannot do
    // three times over. Their radial and palette say which band they belong to.
    const HAND_AUTHORED: Record<string, { bg: string; pal: string }> = {
      raw_mirror_trout: { bg: 'drink', pal: 'sky' },
      raw_deepbarb_catfish: { bg: 'drink', pal: 'sky' },
      raw_hollowgill_sturgeon: { bg: 'shadow', pal: 'steel' },
      raw_stillmere_salmon: { bg: 'frost', pal: 'ice' },
    };
    let fellBackToTheSharedFish = 0;
    for (const id of RAW_COOKING_CATCH_IDS) {
      expect(ITEMS[id].kind, id).toBe('junk');
      const recipe = itemIconRecipe(id);
      const prims = recipe.prims.map((p) => p.p);
      const authored = HAND_AUTHORED[id];
      expect(recipe.bg, id).toBe(authored?.bg ?? 'drink');
      expect(recipe.pal, id).toBe(authored?.pal ?? 'sky');
      if (id === 'raw_mirror_trout') {
        expect(prims, id).toEqual(['droplet', 'fang']);
      } else {
        expect(prims, id).toContain('fish');
      }
      if (!authored) fellBackToTheSharedFish += 1;
    }
    // The fallback arm is still LIVE, which is what the paragraph above is
    // about: six shipped catches still take it, so authoring rows for the new
    // ones did not quietly retire the shared path this arm exists to pin.
    expect(fellBackToTheSharedFish, 'catches still on the shared fish fallback').toBe(6);
  });

  it('name-token fish fallthrough does not use junk trinket scroll for catches', () => {
    // raw_river_perch has no hand-authored ITEM_RECIPES row; it must hit the
    // fish fallback, not trinketPrimitive.
    const recipe = itemIconRecipe('raw_river_perch');
    expect(recipe.prims.map((p) => p.p)).toEqual(['fish']);
    expect(recipe.bg).toBe('drink');
    expect(recipe.pal).toBe('sky');
  });
});
