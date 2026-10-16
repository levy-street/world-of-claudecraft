// Painted ground clutter (Studio Paint Clutter brush). SPACEY: "make 10 diff
// clutter city mini assets with super low polys and no collision ... a new
// tool like the foliage tool that lets you paint the ground clutter and scale
// min and max sizes and clumps ... this clutter only renders when the graphics
// are set high enough even if they have been painted in the studio and the
// performance shouldn't be impacted".

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newFlatCustomMap } from '../src/editor/custom_map';
import { buildCityClutter, prepareCityClutterProfileAssets } from '../src/render/city_clutter';
import {
  clutterItemCount,
  clutterItemsForStamp,
  clutterMeanNearest,
} from '../src/render/city_clutter_core';
import { gfxInternalsForTest } from '../src/render/gfx';
import {
  addClutterStamp,
  CLUTTER_ALL_KINDS,
  CLUTTER_KINDS,
  type ClutterStamp,
  clutterStampsNear,
  eraseClutterStamps,
  MAX_CLUTTER_STAMPS,
} from '../src/sim/city_clutter';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { sanitizeMapDoc } from '../src/sim/map_doc';
import { codeWithoutLineComments } from './helpers/code_without_line_comments';

const mocks = vi.hoisted(() => ({
  loadGltf: vi.fn(),
  registerPreload: vi.fn(),
}));

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: mocks.loadGltf,
  releaseGltf: vi.fn(),
  acquireTexture: vi.fn(),
  loadTexture: vi.fn(),
  loadKtx2Texture: vi.fn(),
}));

vi.mock('../src/render/assets/preload', () => ({
  registerPreload: mocks.registerPreload,
  // Record the thunk without starting it: the module graph under test (custom
  // map projection) registers other modules' preloads at import time, and
  // those must not fetch through the clutter mock. The layer loads on demand.
  registerDeferredPreload: (start: () => Promise<unknown>) => mocks.registerPreload(start),
}));

function clutterGltf(): { scene: THREE.Group } {
  const scene = new THREE.Group();
  const geometry = new THREE.BoxGeometry(0.2, 0.05, 0.2);
  scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x777777 })));
  return { scene };
}

function stamp(over: Partial<ClutterStamp> = {}): ClutterStamp {
  return {
    x: 10,
    z: 20,
    r: 6,
    kinds: CLUTTER_ALL_KINDS,
    density: 4,
    minScale: 0.8,
    maxScale: 1.3,
    clumps: 0,
    seed: 12345,
    ...over,
  };
}

function sourceOf(relativePath: string): string {
  return codeWithoutLineComments(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}

describe('clutter stamps on the document', () => {
  it('round-trips through the sanitizer, dropping junk and clamping the rest', () => {
    const map = newFlatCustomMap('Clutter Test', 'map_clutter_test', 1752710400000, {
      width: 60,
      height: 60,
    });
    map.clutter = [
      stamp(),
      stamp({ x: 1, z: 2, r: 999, density: 99, minScale: 9, maxScale: 0.1, clumps: 40, kinds: 0 }),
      { x: Number.NaN } as unknown as ClutterStamp,
      { x: 1, z: 1, r: 0 } as unknown as ClutterStamp,
    ];
    const doc = sanitizeMapDoc(JSON.parse(JSON.stringify(map)));
    expect(doc?.clutter).toHaveLength(2);
    expect(doc?.clutter?.[0]).toEqual(stamp());
    const clamped = doc?.clutter?.[1];
    expect(clamped?.r).toBe(60);
    expect(clamped?.density).toBe(10);
    expect(clamped?.minScale).toBe(0.25);
    expect(clamped?.maxScale).toBe(4);
    expect(clamped?.clumps).toBe(8);
    expect(clamped?.kinds).toBe(CLUTTER_ALL_KINDS); // an empty mask means everything
    // no stamps: no field, so untouched maps do not grow
    map.clutter = [];
    expect(sanitizeMapDoc(JSON.parse(JSON.stringify(map)))?.clutter).toBeUndefined();
  });

  it('caps the stamp list and keeps the pieces off the placement list', () => {
    const map = newFlatCustomMap('Clutter Cap', 'map_clutter_cap', 1752710400000, {
      width: 60,
      height: 60,
    });
    map.clutter = Array.from({ length: MAX_CLUTTER_STAMPS + 5 }, (_, i) => stamp({ x: i }));
    const doc = sanitizeMapDoc(JSON.parse(JSON.stringify(map)));
    expect(doc?.clutter).toHaveLength(MAX_CLUTTER_STAMPS);
    expect(doc?.placements).toHaveLength(0);
  });

  it('dedupes same-brush stamps inside an existing disc and erases by centre', () => {
    const a = stamp();
    let list = addClutterStamp([], a);
    expect(list).toHaveLength(1);
    // a smaller same-brush disc wholly inside: nothing to add
    expect(addClutterStamp(list, stamp({ x: 11, r: 2 }))).toBe(list);
    // a different brush (denser) is its own stamp even in the same spot
    list = addClutterStamp(list, stamp({ x: 11, r: 2, density: 9 }));
    expect(list).toHaveLength(2);
    // erase lifts the stamps whose centres sit under the eraser
    expect(eraseClutterStamps(list, 50, 50, 3)).toBe(list);
    expect(eraseClutterStamps(list, 11.8, 20, 1)).toHaveLength(1); // only the x=11 centre is under it
    expect(eraseClutterStamps(list, 10.5, 20, 3)).toHaveLength(0);
  });

  it('finds stamps near a point through the bucket index, in document order', () => {
    const stamps = [
      stamp({ x: 0, z: 0, r: 5 }),
      stamp({ x: 200, z: 0, r: 5 }),
      stamp({ x: 40, z: 0, r: 30 }),
    ];
    expect(clutterStampsNear(stamps, 12, 0, 2).map((s) => s.x)).toEqual([40]);
    expect(clutterStampsNear(stamps, 3, 0, 10).map((s) => s.x)).toEqual([0, 40]);
    expect(clutterStampsNear(stamps, 100, 100, 10)).toEqual([]);
    expect(clutterStampsNear(undefined, 0, 0, 10)).toEqual([]);
  });
});

describe('clutter scatter', () => {
  it('is deterministic per stamp and scales with density inside the disc', () => {
    const a = clutterItemsForStamp(stamp());
    expect(clutterItemsForStamp(stamp())).toEqual(a);
    expect(a.length).toBe(clutterItemCount(stamp()));
    expect(clutterItemCount(stamp({ density: 8 }))).toBeGreaterThan(
      clutterItemCount(stamp({ density: 2 })),
    );
    for (const it of a) {
      expect(Math.hypot(it.x - 10, it.z - 20)).toBeLessThanOrEqual(6 + 1e-6);
      expect(it.scale).toBeGreaterThanOrEqual(0.8);
      expect(it.scale).toBeLessThanOrEqual(1.3);
      expect(it.kind).toBeGreaterThanOrEqual(0);
      expect(it.kind).toBeLessThan(CLUTTER_KINDS.length);
    }
    // a different seed is a different scatter
    expect(clutterItemsForStamp(stamp({ seed: 99 }))).not.toEqual(a);
  });

  it('honours the kinds mask', () => {
    const pebbles = CLUTTER_KINDS.indexOf('pebbles');
    const leaves = CLUTTER_KINDS.indexOf('leaves');
    const items = clutterItemsForStamp(
      stamp({ kinds: (1 << pebbles) | (1 << leaves), density: 10 }),
    );
    const kinds = new Set(items.map((it) => it.kind));
    expect([...kinds].sort()).toEqual([pebbles, leaves].sort());
  });

  it('gathers the pieces into piles when clumps are asked for', () => {
    const even = clutterItemsForStamp(stamp({ r: 10, density: 6, clumps: 0 }));
    const piled = clutterItemsForStamp(stamp({ r: 10, density: 6, clumps: 2 }));
    expect(piled.length).toBe(even.length);
    expect(clutterMeanNearest(piled)).toBeLessThan(clutterMeanNearest(even) * 0.7);
    for (const it of piled) expect(Math.hypot(it.x - 10, it.z - 20)).toBeLessThanOrEqual(10 + 1e-6);
  });
});

describe('clutter tier gate', () => {
  it('draws from Medium up, never on low, with a radius that grows up the ladder', () => {
    // Low builds nothing: the layer is pure dressing and that tier has no
    // budget for it.
    expect(gfxInternalsForTest.settingsFor('low').cityClutter).toBe(false);
    // MEDIUM draws. It was High-and-up until 2026-09-22, but medium is the
    // auto-default for every Apple Silicon Mac (resolveDefaultGraphicsPreset
    // returns PRESET_MEDIUM there for THERMAL reasons, not because the GPU is
    // weak), so a High gate hid painted ground dressing from a large class of
    // capable machines, and from the map's own author during playtest, since
    // the editor viewport forces the layer on and the Studio therefore always
    // looked dressed. Medium pays a TIGHT ring instead of the full radius:
    // cost scales with the radius squared, measured +13% frame time at 30yd
    // against +98% at 45yd.
    const medium = gfxInternalsForTest.settingsFor('medium');
    const high = gfxInternalsForTest.settingsFor('high');
    const ultra = gfxInternalsForTest.settingsFor('ultra');
    const insane = gfxInternalsForTest.settingsFor('insane');
    expect(medium.cityClutter).toBe(true);
    expect(high.cityClutter).toBe(true);
    expect(ultra.cityClutter).toBe(true);
    expect(insane.cityClutter).toBe(true);
    expect(medium.cityClutterRadius).toBeLessThan(high.cityClutterRadius);
    expect(high.cityClutterRadius).toBeLessThan(ultra.cityClutterRadius);
    expect(ultra.cityClutterRadius).toBeLessThanOrEqual(insane.cityClutterRadius);
  });

  it('the editor viewport forces the layer on so painting is visible at any tier', () => {
    expect(sourceOf('../src/editor/3d/viewport.ts')).toContain('editorClutter: true');
    const renderer = sourceOf('../src/render/renderer.ts');
    // the built-in world paints no clutter, so it never loads the kit
    expect(renderer).toMatch(
      /buildCityClutter\(\s*this\.sim\.cfg\.seed,\s*isBuiltinWorldActive\(\) \? NO_CITY_CLUTTER : GFX,\s*options\.editorClutter === true,?\s*\)/,
    );
    expect(renderer).toContain(
      'this.cityClutter.update(this.camera.position.x, this.camera.position.z)',
    );
  });
});

describe('clutter layer', () => {
  afterEach(() => {
    setActiveWorldContent(BUILTIN_WORLD);
    mocks.loadGltf.mockReset();
  });

  it('never fetches the clutter GLBs for the built-in world, which has no stamps', async () => {
    mocks.loadGltf.mockImplementation(async () => clutterGltf());
    const calls = mocks.loadGltf.mock.calls.length;
    await prepareCityClutterProfileAssets({ cityClutter: true });
    expect(mocks.loadGltf.mock.calls.length).toBe(calls);
  });

  it('builds nothing at all when the tier is below High', () => {
    mocks.loadGltf.mockImplementation(async () => clutterGltf());
    const calls = mocks.loadGltf.mock.calls.length;
    const view = buildCityClutter(1, { cityClutter: false, cityClutterRadius: 45 });
    view.update(0, 0);
    expect(view.group.children).toHaveLength(0);
    expect(mocks.loadGltf.mock.calls.length).toBe(calls);
  });

  it('scatters the painted stamps near the camera into one instanced mesh per kind', async () => {
    mocks.loadGltf.mockImplementation(async () => clutterGltf());
    const painted = stamp({ x: 0, z: 0, r: 8, density: 6, seed: 7 });
    setActiveWorldContent({ ...BUILTIN_WORLD, clutter: [painted] });
    const view = buildCityClutter(1, { cityClutter: true, cityClutterRadius: 45 });
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(view.group.children).toHaveLength(CLUTTER_KINDS.length);
    view.update(0, 0);
    const counts = view.group.children.map((c) => (c as THREE.InstancedMesh).count);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(clutterItemsForStamp(painted).length);
    // walk out of range: the stamp leaves the pool
    view.update(500, 500);
    expect(
      view.group.children.map((c) => (c as THREE.InstancedMesh).count).reduce((a, b) => a + b, 0),
    ).toBe(0);
    // no shadow pass for pebbles and paper
    for (const c of view.group.children) expect((c as THREE.InstancedMesh).castShadow).toBe(false);
  });
});
