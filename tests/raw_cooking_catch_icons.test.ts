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
    expect(RAW_COOKING_CATCH_IDS.size).toBe(7);
    for (const id of RAW_COOKING_CATCH_IDS) {
      expect(ITEMS[id].kind, id).toBe('junk');
      const recipe = itemIconRecipe(id);
      const prims = recipe.prims.map((p) => p.p);
      expect(recipe.bg, id).toBe('drink');
      expect(recipe.pal, id).toBe('sky');
      if (id === 'raw_mirror_trout') {
        expect(prims, id).toEqual(['droplet', 'fang']);
      } else {
        expect(prims, id).toContain('fish');
      }
    }
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
