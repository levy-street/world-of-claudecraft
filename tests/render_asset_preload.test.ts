import { describe, expect, it } from 'vitest';
import { characterPreloadUrls, manifestUrlsForGraphics } from '../src/render/characters/manifest';
import { propPreloadInternalsForTest } from '../src/render/props';

// Guard against the v0.16.0 "Could not start the renderer" P0. Both props (props.ts)
// and characters (characters/assets.ts) freeze their GLB PRELOAD set at module-import
// time from a graphics-tier GUESS (GFX.standardMaterials), but PLACEMENT runs later
// against the LIVE tier resolved inside the Renderer constructor (initGfxTier reassigns
// the GFX global after import). When the import-time guess came in LOWER than the live
// render tier (weak/hybrid-GPU probe guesses low, the high-performance renderer resolves
// medium+), a prop/character was placed that the lower import tier never preloaded, and
// the synchronous accessor threw "... asset not preloaded", crashing world entry.
//
// The fix makes both preload sets tier-INDEPENDENT (a superset of every tier's placement
// set), the way foliage.ts has always sourced one frozen list for both preload and
// placement. These tests assert that invariant at EVERY import-time tier, in particular
// the lowest (the only one that could shrink the set and crash).

describe('prop preload set covers placement at every graphics tier (v0.16.0 farmCrate P0)', () => {
  const { allPropKeys, lowTierPropKeys, preloadPropKeys } = propPreloadInternalsForTest;
  const fullCatalog = new Set(allPropKeys);

  it('preloads the full prop catalog regardless of the import-time tier guess', () => {
    // Every key buildProps() can place is typed PropKey (a key of PROP_ASSET_DEFS), so the
    // full catalog is a provable superset of any tier's placement set.
    for (const importTierStandardMaterials of [false, true]) {
      expect(preloadPropKeys(importTierStandardMaterials)).toEqual(fullCatalog);
    }
  });

  it('the low render subset is strict, so a tier-scoped preload would have crashed', () => {
    // Documents WHY the preload must be tier-independent: low renders a subset, so freezing
    // the preload to a low import-time guess omits the medium+ props (e.g. farmCrate, the
    // first prop buildProps reaches at a market stall).
    const lowRendered = new Set(lowTierPropKeys);
    expect(lowRendered.size).toBeLessThan(allPropKeys.length);
    expect(lowRendered.has('farmCrate')).toBe(false);
    // ...yet the actual preload set still contains it, even when the import tier was low.
    expect(preloadPropKeys(false).has('farmCrate')).toBe(true);
  });
});

describe('character preload set covers placement at every graphics tier (v0.16.0 twin)', () => {
  const low = new Set(manifestUrlsForGraphics(false));
  const high = new Set(manifestUrlsForGraphics(true));
  const union = new Set([...low, ...high]);

  it('a real tier divergence exists (low aliases a body GLB the high tier still places)', () => {
    // If this ever goes empty, the LOW_URL_ALIAS divergence is gone and this guard no longer
    // guards anything: revisit. Today the mob_bandit body (rogue_hooded.glb), the humanoid
    // default and global mob fallback, is the diverging key.
    const onlyHigh = [...high].filter((u) => !low.has(u));
    expect(onlyHigh.length).toBeGreaterThan(0);
    expect(onlyHigh).toContain('models/chars/players/rogue_hooded.glb');
  });

  it('preloads the union of both tiers regardless of the import-time tier guess', () => {
    for (const importTierStandardMaterials of [false, true]) {
      const preload = new Set(characterPreloadUrls(importTierStandardMaterials));
      for (const url of union) {
        expect(
          preload.has(url),
          `import tier sm=${importTierStandardMaterials} must preload ${url}`,
        ).toBe(true);
      }
    }
  });
});
