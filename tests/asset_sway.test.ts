// Per-asset wind-sway opt-out (MapDoc.assetSway -> WorldContent.assetSway ->
// render/tree_sway). Sway is ON by default; the document stores only the
// assets a maker has stilled.

import { afterEach, describe, expect, it } from 'vitest';
import { customMapToWorldContent, newCustomMap } from '../src/editor/custom_map';
import { attachPlacedTreeSway, detachPlacedTreeSway } from '../src/render/placed_assets';
import {
  naturalSwayKindForAssetPath,
  setSwayDisabledAssets,
  swayDisabledForPath,
  swayKindForAssetPath,
} from '../src/render/tree_sway';
import { sanitizeMapDoc } from '../src/sim/map_doc';

const NOW = 1753488000000; // 2026-07-26

afterEach(() => setSwayDisabledAssets([]));

describe('sway opt-out gate', () => {
  it('leaves the heuristic alone when nothing is disabled', () => {
    expect(swayKindForAssetPath('/models/nature/Ivy_01.glb')).toBe('bush');
    expect(swayKindForAssetPath('/models/foliage/oak_1.glb')).toBe('tree');
    expect(swayKindForAssetPath('/models/props/crate_wooden.glb')).toBeNull();
  });

  it('stills an asset by catalogue id', () => {
    setSwayDisabledAssets(['nature/Ivy_01']);
    expect(swayKindForAssetPath('/models/nature/Ivy_01.glb')).toBeNull();
    // Its siblings are untouched: the toggle is per asset, not per family.
    expect(swayKindForAssetPath('/models/nature/Ivy_02.glb')).toBe('bush');
  });

  it('stills an asset by raw path too, for imported models', () => {
    setSwayDisabledAssets(['local/abc123']);
    expect(swayDisabledForPath('local/abc123')).toBe(true);
    expect(swayDisabledForPath('/models/nature/Ivy_01.glb')).toBe(false);
  });

  it('re-enables cleanly when the set is replaced', () => {
    setSwayDisabledAssets(['nature/Ivy_01']);
    expect(swayKindForAssetPath('/models/nature/Ivy_01.glb')).toBeNull();
    setSwayDisabledAssets([]);
    expect(swayKindForAssetPath('/models/nature/Ivy_01.glb')).toBe('bush');
  });

  it('never makes a rigid asset sway', () => {
    // The gate can only ever REMOVE sway; disabling something rigid is a no-op.
    setSwayDisabledAssets(['props/crate_wooden']);
    expect(swayKindForAssetPath('/models/props/crate_wooden.glb')).toBeNull();
  });
});

describe('assetSway document round-trip', () => {
  it('keeps the opt-outs and drops redundant on-by-default entries', () => {
    const doc = sanitizeMapDoc({
      ...JSON.parse(JSON.stringify(newCustomMap('Sway', 'map_sway', NOW))),
      assetSway: {
        'nature/Ivy_01': false,
        // `true` is the default and carries no information; storing it would
        // grow a document by an entry per placed plant.
        'nature/Ivy_02': true,
        'nature/Ivy_03': 'nope',
      },
    });
    expect(doc?.assetSway).toEqual({ 'nature/Ivy_01': false });
  });

  it('omits the field entirely when nothing is stilled', () => {
    const doc = sanitizeMapDoc({
      ...JSON.parse(JSON.stringify(newCustomMap('Sway', 'map_sway', NOW))),
      assetSway: { 'nature/Ivy_02': true },
    });
    expect(doc?.assetSway).toBeUndefined();
  });
});

describe('projection into playtest', () => {
  it('carries the opt-outs onto the standalone world', () => {
    const map = newCustomMap('Sway', 'map_sway', NOW);
    map.assetSway = { 'nature/Ivy_01': false };
    expect(customMapToWorldContent(map).assetSway).toEqual({ 'nature/Ivy_01': false });
  });

  it('carries them onto a world-linked map as well', () => {
    const map = newCustomMap('Sway', 'map_sway', NOW);
    map.assetSway = { 'nature/Ivy_01': false };
    map.worldAnchor = { x: -200, z: 800 };
    // Unlike music areas, sway needs no offset: it is keyed by asset, not place.
    expect(customMapToWorldContent(map).assetSway).toEqual({ 'nature/Ivy_01': false });
  });

  it('leaves the field off a map that never touched sway', () => {
    const map = newCustomMap('Sway', 'map_sway', NOW);
    expect(customMapToWorldContent(map).assetSway).toBeUndefined();
  });
});

// REGRESSION (Troy, 2026-07-26): "when you uncheck wind sway you can't recheck
// it, and undo doesn't bring it back." Two separate causes, one per describe.
describe('the toggle can be turned back on', () => {
  it('still reports the asset as swayable while sway is OFF', () => {
    // The editor asks this to decide whether to SHOW the checkbox. The gated
    // swayKindForAssetPath answers null once sway is off, which read as "this
    // asset is rigid" and removed the control entirely - so it could never be
    // re-checked. The natural kind is the shape of the thing, not its setting.
    setSwayDisabledAssets(['nature/Ivy_01']);
    expect(swayKindForAssetPath('/models/nature/Ivy_01.glb')).toBeNull();
    expect(naturalSwayKindForAssetPath('/models/nature/Ivy_01.glb')).toBe('bush');
  });

  it('agrees with the gated kind whenever nothing is disabled', () => {
    for (const path of [
      '/models/nature/Ivy_01.glb',
      '/models/foliage/oak_1.glb',
      '/models/props/crate_wooden.glb',
    ]) {
      expect(naturalSwayKindForAssetPath(path)).toBe(swayKindForAssetPath(path));
    }
  });
});

describe('sway attach/detach round-trip', () => {
  interface FakeMaterial {
    name: string;
    uuid: string;
    userData: Record<string, unknown>;
    onBeforeCompile?: unknown;
    customProgramCacheKey?: () => string;
    needsUpdate: boolean;
  }

  function leafObject(): { object: never; mat: FakeMaterial } {
    const mat: FakeMaterial = {
      name: 'Leaves',
      uuid: 'mat-1',
      userData: {},
      needsUpdate: false,
    };
    const mesh = { isMesh: true, material: mat };
    const object = {
      traverse(fn: (o: unknown) => void) {
        fn(mesh);
      },
    };
    return { object: object as never, mat };
  }

  it('marks the material for recompile when sway is re-attached', () => {
    const { object, mat } = leafObject();
    attachPlacedTreeSway(object, 0, 3, 'bush');
    expect(mat.userData.wocTreeSway).toBe(true);

    detachPlacedTreeSway(object);
    expect(mat.userData.wocTreeSway).toBeUndefined();
    expect(mat.needsUpdate).toBe(true);

    // Turning it back on has to recompile too. Without this the material keeps
    // the no-sway program it was just built with and stays frozen forever.
    mat.needsUpdate = false;
    attachPlacedTreeSway(object, 0, 3, 'bush');
    expect(mat.userData.wocTreeSway).toBe(true);
    expect(mat.needsUpdate).toBe(true);
    expect(mat.customProgramCacheKey?.()).toContain('woc-tree-sway');
  });

  it('survives repeated off/on cycles', () => {
    const { object, mat } = leafObject();
    for (let i = 0; i < 3; i++) {
      attachPlacedTreeSway(object, 0, 3, 'bush');
      expect(mat.customProgramCacheKey?.()).toContain('woc-tree-sway');
      detachPlacedTreeSway(object);
      expect(mat.customProgramCacheKey?.()).toContain('woc-no-sway');
    }
  });

  it('leaves a material alone that never had sway', () => {
    const { object, mat } = leafObject();
    detachPlacedTreeSway(object);
    expect(mat.needsUpdate).toBe(false);
  });
});
