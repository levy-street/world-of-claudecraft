import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  characterPreloadUrls,
  manifestUrlsForGraphics,
  modularVisualKey,
  VISUALS,
  visualKeyFor,
} from '../src/render/characters/manifest';
import { DEFAULT_APPEARANCE, MODULAR_WARRIOR_KEY } from '../src/render/characters/modular';
import { charselectLook, inWorldLookFor } from '../src/render/characters/player_look_core';
import { classBodyComposes } from '../src/render/characters/woc_parts_core';
import { foliagePreloadInternalsForTest } from '../src/render/foliage';
import { propPreloadInternalsForTest } from '../src/render/props';
import { ALL_CLASSES, type Entity } from '../src/sim/types';

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

  it('always preloads the active Duskmurk tank model', () => {
    const gloomshadeUrl = 'models/creatures/gloomshade_abyssal_guardian.glb';
    expect(low).toContain(gloomshadeUrl);
    expect(high).toContain(gloomshadeUrl);
    for (const importTierStandardMaterials of [false, true]) {
      expect(characterPreloadUrls(importTierStandardMaterials)).toContain(gloomshadeUrl);
    }
  });
});

// PR 4360 review, N12. Every class is a WOC body now, so no player composes the KayKit
// modular library any more, yet each class's composed def (`player_<class>_modular`) still
// put the retired KayKit class rig and its donor clip GLBs in every client's boot download.
// Those defs are fetched on demand instead. Three things must stay true for that to be safe.
describe('composed player defs nobody can reach stay out of the boot download', () => {
  const boot = new Set(characterPreloadUrls(false));
  const urlsOf = (key: string): string[] => {
    const def = VISUALS[key];
    return [def.url, ...(def.animUrls ?? []), ...(def.attach ?? []).map((a) => a.url)];
  };
  const composedKeys = ALL_CLASSES.map((cls) => modularVisualKey(cls));
  const onDemand = composedKeys.filter((key) => VISUALS[key].lazyPreload);

  it('no player composes: the reason the defs are unreachable', () => {
    // If a class ever composes again, its def must go back in the boot gate: a body built
    // by the world or a preview resolves its files synchronously.
    const look = { ...DEFAULT_APPEARANCE };
    for (const cls of ALL_CLASSES) {
      expect(classBodyComposes(cls), cls).toBe(false);
      const entity = {
        kind: 'player',
        templateId: cls,
        modularAppearance: look,
      } as unknown as Entity;
      expect(
        inWorldLookFor(entity, () => 'knight'),
        cls,
      ).toBeNull();
      expect(charselectLook({ class: cls, appearance: look }), cls).toBeNull();
      expect(VISUALS[`player_${cls}`].wocCharacter, cls).toBeDefined();
    }
  });

  it('fetches every one on demand, the library fallback included', () => {
    // MODULAR_WARRIOR_KEY is what modularKeyFor hands a composed player whose class has no
    // def of its own. It stayed in the boot gate while every world NPC composed from the
    // same part library; each rides a WOC class body now (characters/npc_looks.ts), so
    // nothing in the world builds from the library and it is on demand with the rest.
    expect(composedKeys).toContain(MODULAR_WARRIOR_KEY);
    expect([...onDemand].sort()).toEqual([...composedKeys].sort());
    const library = 'models/chars/modular/warrior_modular.glb';
    expect(VISUALS[MODULAR_WARRIOR_KEY].url).toBe(library);
    expect(boot.has(library)).toBe(false);
    // no boot def names the library any more (an NPC def that did would put it back)
    const holders = Object.entries(VISUALS)
      .filter(([, def]) => !def.lazyPreload && def.url === library)
      .map(([key]) => key);
    expect(holders).toEqual([]);
    // 3,477,500 B at the move: fail if the file this saves quietly stops being the library
    expect(statSync(`public/${library}`).size).toBeGreaterThan(3_000_000);
  });

  it('fetches the two stock NPC rigs no boot def names on demand too', () => {
    // Brother Aldric's and Brother Halven's old bodies: each wears an authored look on a
    // WOC class body now, and no other boot def names these files, so they left the gate.
    for (const [key, file] of [
      ['npc_aldric', 'models/chars/players/mage_classic.glb'],
      ['npc_reliquary_keeper', 'models/chars/players/paladin.glb'],
    ] as const) {
      expect(VISUALS[key].lazyPreload, key).toBe(true);
      expect(VISUALS[key].url, key).toBe(file);
      expect(boot.has(file), file).toBe(false);
    }
    // and neither is what its NPC draws
    expect(visualKeyFor({ kind: 'npc', templateId: 'brother_aldric' } as never)).toBe(
      'player_priest',
    );
    expect(visualKeyFor({ kind: 'npc', templateId: 'brother_halven' } as never)).toBe(
      'player_paladin',
    );
  });

  it('downloads none of the files only those defs name', () => {
    // the files no boot def, no item and no weapon skin still asks for
    const heldElsewhere = new Set<string>();
    for (const [key, def] of Object.entries(VISUALS)) {
      if (!def.lazyPreload) for (const url of urlsOf(key)) heldElsewhere.add(url);
      // a WOC body's held weapons are boot files in their own right (next case)
      if (def.wocCharacter) for (const a of def.attach ?? []) heldElsewhere.add(a.url);
    }
    const orphaned = [...new Set(onDemand.flatMap(urlsOf))].filter(
      (url) => !heldElsewhere.has(url) && !url.startsWith('models/weapons/'),
    );
    // the retired KayKit hunter rig is the largest of them
    expect(orphaned).toContain('models/chars/players/ranger.glb');
    for (const url of orphaned) expect(boot.has(url), `${url} still preloads at boot`).toBe(false);
    const saved = orphaned.reduce((sum, url) => sum + statSync(`public/${url}`).size, 0);
    // 1,254,556 B at the time of the review's census: fail if the saving quietly vanishes
    expect(saved).toBeGreaterThan(1_000_000);
  });

  it('keeps every weapon a WOC body holds in the boot gate in its own right', () => {
    // A held prop attaches synchronously at build, and a WOC def is lazy for its base and
    // library only. The warlock's wand is the case that needs the rule: nothing else in the
    // boot set asks for it, so without the rule it would be gone (shown by taking the rule's
    // input away: the same sweep over warlock defs that are not WOC bodies).
    const wand = 'models/weapons/wand.glb';
    const warlocks = [VISUALS.player_warlock, VISUALS.player_warlock_female];
    for (const def of warlocks) expect(def.attach?.map((a) => a.url)).toContain(wand);
    expect(boot.has(wand)).toBe(true);
    const manifests = warlocks.map((def) => def.wocCharacter);
    try {
      for (const def of warlocks) def.wocCharacter = undefined;
      expect(characterPreloadUrls(false)).not.toContain(wand);
    } finally {
      warlocks.forEach((def, i) => {
        def.wocCharacter = manifests[i];
      });
    }
    expect(characterPreloadUrls(false)).toContain(wand);
  });

  it('keeps every prop any on-demand def holds in the boot gate', () => {
    // The general form: `lazyPreload` takes a def's body and clip files out of the boot
    // gate, never a prop it holds (the Combat Mech's sword, a WOC body's weapons, a composed
    // def's class kit). A lazy def whose prop is in no boot set builds into a throw.
    let props = 0;
    for (const [key, def] of Object.entries(VISUALS)) {
      if (!def.lazyPreload) continue;
      for (const a of def.attach ?? []) {
        props++;
        expect(boot.has(a.url), `${key} holds ${a.url}`).toBe(true);
      }
    }
    expect(props).toBeGreaterThan(20);
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
    // is just pine_1): the variant the live crash report named.
    expect(low.has('models/foliage/pine_2_field.glb')).toBe(false);
    expect(highTierFoliageModelUrls().has('models/foliage/pine_2_field.glb')).toBe(true);
    expect(all.has('models/foliage/pine_2_field.glb')).toBe(true);
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
