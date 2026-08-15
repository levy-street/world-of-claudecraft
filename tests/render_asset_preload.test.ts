import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { characterPreloadUrls, manifestUrlsForGraphics } from '../src/render/characters/manifest';
import { foliagePreloadInternalsForTest } from '../src/render/foliage';
import { propPreloadInternalsForTest } from '../src/render/props';

// Guard against the v0.16.0 "Could not start the renderer" P0. Props (props.ts),
// characters (characters/assets.ts), and foliage (foliage.ts) all freeze their GLB
// PRELOAD set at module-import/deferred-lane-open time from a graphics-tier GUESS
// (GFX.standardMaterials / GFX.leanFoliage), but PLACEMENT runs later against the LIVE
// tier resolved inside the Renderer constructor (initGfxTier reassigns the GFX global
// after import, from the real WebGL gpuRenderer string). When the import-time guess came
// in LOWER than the live render tier (weak/hybrid-GPU probe guesses low, the
// high-performance renderer resolves medium+), a prop/character/foliage model was placed
// that the lower import tier never preloaded, and the synchronous accessor threw "...
// asset not preloaded", crashing world entry.
//
// The fix makes every preload set tier-INDEPENDENT (a superset of every tier's placement
// set). Foliage regressed this once already: a `deferredFoliageUrlsForBoot()` gate was
// added to skip a url whose tier didn't match a frozen boot-time guess, silently
// reintroducing the exact bug this suite exists to prevent ("foliage model not
// preloaded: models/foliage/pine_2.glb"), uncaught because this file never had a foliage
// case. These tests assert the tier-independence invariant at EVERY import-time tier, in
// particular the lowest (the only one that could shrink the set and crash).

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

  it('always preloads the active Gloomshade tank model', () => {
    const gloomshadeUrl = 'models/creatures/gloomshade_abyssal_guardian.glb';
    expect(low).toContain(gloomshadeUrl);
    expect(high).toContain(gloomshadeUrl);
    for (const importTierStandardMaterials of [false, true]) {
      expect(characterPreloadUrls(importTierStandardMaterials)).toContain(gloomshadeUrl);
    }
  });
});

describe('foliage preload set covers placement at every graphics tier (regression: the deferred lane silently re-scoped this to the import-time tier guess)', () => {
  const { allFoliageModelUrls, lowTierFoliageModelUrls, highTierFoliageModelUrls } =
    foliagePreloadInternalsForTest;

  it('a real tier divergence exists (low renders a strict subset of the full catalog)', () => {
    const low = lowTierFoliageModelUrls();
    const all = allFoliageModelUrls();
    expect(low.size).toBeLessThan(all.size);
    // pine_2/4/5 only exist in the HIGH tier's variant set (FOLIAGE_MODEL_URLS_LOW.pine
    // is just pine_1): the exact url the live crash report named.
    expect(low.has('models/foliage/pine_2.glb')).toBe(false);
    expect(highTierFoliageModelUrls().has('models/foliage/pine_2.glb')).toBe(true);
    expect(all.has('models/foliage/pine_2.glb')).toBe(true);
  });

  it('ALL_FOLIAGE_MODEL_URLS is constructed as the exact HIGH union LOW superset (a data-shape invariant, not a runtime one: see tests/foliage_preload_boot.test.ts for proof the deferred loop actually FETCHES every one of these regardless of the import-time tier guess)', () => {
    const all = allFoliageModelUrls();
    const high = highTierFoliageModelUrls();
    const low = lowTierFoliageModelUrls();
    for (const url of high) expect(all.has(url)).toBe(true);
    for (const url of low) expect(all.has(url)).toBe(true);
    expect(all.size).toBe(high.size);
  });

  it('the deferred preload loop never skips a url by tier (no frozen-guess gate remains)', () => {
    const source = readFileSync(new URL('../src/render/foliage.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/function deferredFoliageUrlsForBoot/);
    expect(source).toMatch(
      /for \(const url of ALL_FOLIAGE_MODEL_URLS\) \{\s*registerDeferredPreload\(\(\) =>\s*prepareFoliageSource\(url\)/,
    );
  });
});

describe('extracted world assets release their duplicate parsed glTF sources', () => {
  it('caches foliage extraction before releasing the parsed source scene', () => {
    const source = readFileSync(new URL('../src/render/foliage.ts', import.meta.url), 'utf8');
    expect(source).toContain("import { loadGltf, releaseGltf } from './assets/loader';");
    expect(source).toContain('const extractedParts = new Map<string, ModelPart[]>();');
    expect(source).toContain('const cached = extractedParts.get(url);');
    expect(source).toContain('loadedModels.delete(url);');
    expect(source).toContain('releaseGltf(url);');
  });

  it('releases each prop source after its extracted geometry is cached', () => {
    const source = readFileSync(new URL('../src/render/props.ts', import.meta.url), 'utf8');
    expect(source).toContain("import { loadGltf, releaseGltf } from './assets/loader';");
    expect(source).toContain('loadedProps.delete(key);');
    expect(source).toContain('releaseGltf(def.url);');
    expect(source).toContain(
      "if (!loadedProps.has('delveEntrance2') && !extractCache.has('delveEntrance2')) continue;",
    );
  });
});
