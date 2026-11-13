import fs from 'node:fs';
import path from 'node:path';
import { getBounds, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTownSmart } from '../src/render/assets/town_smart_material';
import {
  ensurePalaceTileAssets,
  isPalaceVariant,
  PALACE_TILE_URLS,
  palaceSlabBox,
  palaceSlabMaterial,
  palaceTileInternalsForTest,
  palaceTileParts,
} from '../src/render/palace_tile_kit';
import { isSharedMaterial } from '../src/render/shared_resource';

// The kit's own load is driven through a stand-in loader (hoisted above the
// imports by vitest), so a case decides which module arrives, which fails, and
// what scene each one carries. Every other loader export stays real for the
// modules the kit pulls in beside it.
const mocks = vi.hoisted(() => ({ loadGltf: vi.fn() }));

vi.mock('../src/render/assets/loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/assets/loader')>()),
  loadGltf: mocks.loadGltf,
}));

// The two walk-in palaces draw their floors, walls, and pillars from the
// painted castle kit. The interior builder keeps placing dungeon-kit kinds at
// dungeon-kit scales, and the sim keeps its dungeon-kit collision, so a
// painted module that drifts off its dungeon module's footprint opens a seam
// in a wall or floats a floor. These pins hold the kit to that contract.

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

async function bounds(file: string): Promise<{ min: number[]; max: number[] }> {
  const doc = await io.readBinary(new Uint8Array(fs.readFileSync(file)));
  return getBounds(doc.getRoot().listScenes()[0]);
}

const publicFile = (url: string): string => path.resolve(process.cwd(), `public${url}`);

const MODULE_URLS = [...new Set(Object.values(PALACE_TILE_URLS))];
const WALL_URL = PALACE_TILE_URLS.wall;
const WINDOW_URL = PALACE_TILE_URLS.wall_archedwindow_gated;

/** A kit material as the loader names it (`eh_ashlar`, `eh_glass`, ...). */
function kitMaterial(name: string, color: number): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color });
  mat.name = name;
  return mat;
}

/** One painted module as the loader hands it over: a group of meshes, each
 *  with one material (the loader turns every glTF primitive into its own mesh). */
function moduleScene(materials: readonly THREE.Material[]): THREE.Group {
  const scene = new THREE.Group();
  for (const material of materials) {
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(4, 4, 1), material));
  }
  return scene;
}

/** Answer the kit's loads: a named scene for the urls a case cares about, a
 *  rejection for the ones it takes offline, a plain ashlar module otherwise. */
function serveModules(
  scenes: Readonly<Record<string, THREE.Group>> = {},
  offline: ReadonlySet<string> = new Set(),
): void {
  mocks.loadGltf.mockImplementation(async (url: string) => {
    if (offline.has(url)) throw new Error(`asset load failed: ${url}`);
    return { scene: scenes[url] ?? moduleScene([kitMaterial('eh_ashlar', 0xffffff)]) };
  });
}

const requestedUrls = (): string[] => mocks.loadGltf.mock.calls.map(([url]) => url as string);

describe('the palaces painted tile kit', () => {
  beforeAll(async () => {
    await MeshoptDecoder.ready;
    io.registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  });

  beforeEach(() => {
    palaceTileInternalsForTest.reset();
    mocks.loadGltf.mockReset();
    serveModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serves exactly the two palaces', () => {
    expect(isPalaceVariant('dawnhold')).toBe(true);
    expect(isPalaceVariant('lastkeep')).toBe(true);
    for (const variant of ['crypt', 'bastion', 'sanctum', 'temple', 'ignivar', 'delve_marsh']) {
      expect(isPalaceVariant(variant)).toBe(false);
      // every other interior keeps the shared dungeon kit, whatever the kind
      for (const kind of Object.keys(PALACE_TILE_URLS)) {
        expect(palaceTileParts(variant, kind)).toBeUndefined();
      }
      expect(palaceSlabMaterial(variant)).toBeUndefined();
    }
  });

  it('leaves non-structural kinds, and an unloaded kit, on the shared dungeon kit', () => {
    for (const kind of [
      'torch_mounted',
      'banner_red',
      'chest',
      'candle_triple',
      'floor_tile_grate',
    ]) {
      expect(PALACE_TILE_URLS[kind]).toBeUndefined();
      expect(palaceTileParts('dawnhold', kind)).toBeUndefined();
    }
    // nothing has been asked for yet, so a structural kind falls back too
    expect(palaceTileParts('dawnhold', 'wall')).toBeUndefined();
    expect(palaceSlabMaterial('dawnhold')).toBeUndefined();
  });

  it('covers every floor, wall, and pillar kind the authored interiors place', () => {
    const structural = [
      'floor_tile_large',
      'floor_tile_large_rocks',
      'floor_dirt_large',
      'floor_dirt_large_rocky',
      'floor_tile_small',
      'floor_tile_small_broken_A',
      'floor_tile_small_broken_B',
      'floor_tile_small_weeds_A',
      'floor_tile_small_weeds_B',
      'floor_tile_small_decorated',
      'floor_foundation_allsides',
      'wall',
      'wall_cracked',
      'wall_pillar',
      'wall_arched',
      'wall_archedwindow_gated',
      'wall_gated',
      'pillar',
      'pillar_decorated',
    ];
    expect(Object.keys(PALACE_TILE_URLS).sort()).toEqual([...structural].sort());
  });

  it('ships a painted module on the footprint and seat of each dungeon module', async () => {
    for (const [kind, url] of Object.entries(PALACE_TILE_URLS)) {
      const file = publicFile(url);
      expect(fs.existsSync(file), `missing ${file}`).toBe(true);
      // a real mesh, never an empty stub
      expect(fs.statSync(file).size).toBeGreaterThan(2000);
      const painted = await bounds(file);
      const dungeon = await bounds(publicFile(`/models/dungeon/${kind}.glb`));
      // the run of a wall, the side of a floor tile: the axis walls and tiles meet on
      expect(painted.min[0], `${kind} left edge`).toBeCloseTo(dungeon.min[0], 1);
      expect(painted.max[0], `${kind} right edge`).toBeCloseTo(dungeon.max[0], 1);
      // the seat every placement stands the module on
      expect(painted.min[1], `${kind} seat`).toBeCloseTo(dungeon.min[1], 1);
      // a painted stand-in may be plainer than its dungeon module, never taller or deeper
      expect(painted.max[1], `${kind} top`).toBeLessThanOrEqual(dungeon.max[1] + 0.02);
      expect(painted.max[2] - painted.min[2], `${kind} depth`).toBeLessThanOrEqual(
        dungeon.max[2] - dungeon.min[2] + 0.02,
      );
      if (kind.startsWith('wall') || kind.startsWith('pillar')) {
        // walls and pillars stack into a second storey, so their height is exact
        expect(painted.max[1], `${kind} height`).toBeCloseTo(dungeon.max[1], 1);
      }
    }
  });

  it('tiles a slab at the true size of the stone, face by face', () => {
    // one repeat of the painted ashlar covers 5.2 yards
    const box = palaceSlabBox(10.4, 2.6, 5.2);
    const uv = box.getAttribute('uv');
    const faceMax = (face: number): [number, number] => {
      let u = 0;
      let v = 0;
      for (let i = face * 4; i < face * 4 + 4; i++) {
        u = Math.max(u, uv.getX(i));
        v = Math.max(v, uv.getY(i));
      }
      return [u, v];
    };
    // +x and -x faces span depth by height
    expect(faceMax(0)).toEqual([1, 0.5]);
    expect(faceMax(1)).toEqual([1, 0.5]);
    // +y and -y faces span width by depth
    expect(faceMax(2)).toEqual([2, 1]);
    expect(faceMax(3)).toEqual([2, 1]);
    // +z and -z faces span width by height
    expect(faceMax(4)).toEqual([2, 0.5]);
    expect(faceMax(5)).toEqual([2, 0.5]);
  });

  it('asks the loader for nothing outside a palace', async () => {
    for (const variant of ['crypt', 'bastion', 'ignivar', 'delve_marsh']) {
      await ensurePalaceTileAssets(variant);
    }
    expect(mocks.loadGltf).not.toHaveBeenCalled();
    await ensurePalaceTileAssets('dawnhold');
    // each painted module once, however many kinds resolve to it
    expect(requestedUrls().sort()).toEqual([...MODULE_URLS].sort());
  });

  it('keeps the shader layers of the loader material on the graded and slab stone', async () => {
    // The layer the loader itself attaches at parse (town_smart_material.ts): a
    // weathering recipe in the material extras over a mask in the occlusion slot.
    const ashlar = kitMaterial('eh_ashlar', 0xffffff);
    ashlar.aoMap = new THREE.Texture();
    ashlar.userData.townSmart = {
      dirt: [0.2, 0.18, 0.15],
      dirtAmt: 0.6,
      moss: [0.2, 0.3, 0.1],
      mossAmt: 0.4,
      edge: [0.9, 0.85, 0.7],
      edgeAmt: 0.5,
      aoDiffuse: 0.5,
    };
    expect(applyTownSmart(ashlar)).toBe(true);
    const stockHook = THREE.Material.prototype.onBeforeCompile;
    expect(ashlar.onBeforeCompile).not.toBe(stockHook);
    // what the kit used to do: a bare clone loses the layer and its program key
    expect(ashlar.clone().onBeforeCompile).toBe(stockHook);
    expect(ashlar.clone().customProgramCacheKey()).not.toBe(ashlar.customProgramCacheKey());

    serveModules({ [WALL_URL]: moduleScene([ashlar]) });
    await ensurePalaceTileAssets('dawnhold');

    const graded = palaceTileParts('dawnhold', 'wall')?.[0].mat;
    expect(graded).toBeDefined();
    expect(graded).not.toBe(ashlar);
    expect(graded?.onBeforeCompile).not.toBe(stockHook);
    expect(graded?.customProgramCacheKey()).toBe(ashlar.customProgramCacheKey());

    const slab = palaceSlabMaterial('dawnhold');
    expect(slab).toBeDefined();
    expect(slab).not.toBe(ashlar);
    expect(slab).not.toBe(graded);
    expect(slab?.onBeforeCompile).not.toBe(stockHook);
    expect(slab?.customProgramCacheKey()).toBe(ashlar.customProgramCacheKey());
  });

  it('grades the stone alone: glass, glow and trim keep the loader material', async () => {
    const ashlar = kitMaterial('eh_ashlar', 0xffffff);
    const stone = kitMaterial('eh_stone', 0xc0c0c0);
    const trim = kitMaterial('eh_trim', 0x806040);
    const glass = kitMaterial('eh_glass', 0xffffff);
    glass.emissive.setHex(0xcccccc);
    const glow = kitMaterial('eh_parts_glow', 0xffe0b0);
    serveModules({ [WINDOW_URL]: moduleScene([ashlar, stone, trim, glass, glow]) });
    await ensurePalaceTileAssets('lastkeep');

    // one part per surface of the module, in the order the loader handed them over
    const parts = palaceTileParts('lastkeep', 'wall_archedwindow_gated') ?? [];
    expect(parts.map((part) => part.mat.name)).toEqual([
      'eh_ashlar',
      'eh_stone',
      'eh_trim',
      'eh_glass',
      'eh_parts_glow',
    ]);
    const drawn = parts.map((part) => part.mat as THREE.MeshStandardMaterial);

    // the two stone surfaces: a clone carrying the keep's grade, shared like its source
    const keepGrade = new THREE.Color(0xa8a094);
    for (const [index, source, hex] of [
      [0, ashlar, 0xffffff],
      [1, stone, 0xc0c0c0],
    ] as const) {
      expect(drawn[index]).not.toBe(source);
      expect(drawn[index].color.getHex()).toBe(new THREE.Color(hex).multiply(keepGrade).getHex());
      expect(drawn[index].color.getHex()).not.toBe(hex);
      expect(isSharedMaterial(drawn[index])).toBe(true);
      // the loader's own material is never tinted in place
      expect(source.color.getHex()).toBe(hex);
    }

    // everything else: the loader's own material, at its own colour, still shared
    for (const [index, source, hex] of [
      [2, trim, 0x806040],
      [3, glass, 0xffffff],
      [4, glow, 0xffe0b0],
    ] as const) {
      expect(drawn[index]).toBe(source);
      expect(source.color.getHex()).toBe(hex);
      expect(isSharedMaterial(source)).toBe(true);
    }
    expect(glass.emissive.getHex()).toBe(0xcccccc);

    // the garden palace grades the same stone a step lighter, on its own clone
    await ensurePalaceTileAssets('dawnhold');
    const garden = (palaceTileParts('dawnhold', 'wall_archedwindow_gated') ?? []).map(
      (part) => part.mat as THREE.MeshStandardMaterial,
    );
    expect(garden[0]).not.toBe(drawn[0]);
    expect(garden[0].color.getHex()).toBe(
      new THREE.Color(0xffffff).multiply(new THREE.Color(0xbdb6a9)).getHex(),
    );
    expect(garden[3]).toBe(glass);
  });

  it('asks again, at the next palace build, for a module that failed to load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const offline = new Set([WALL_URL]);
    serveModules({}, offline);

    await ensurePalaceTileAssets('lastkeep');
    expect(requestedUrls().sort()).toEqual([...MODULE_URLS].sort());
    // the missing module's kinds keep the dungeon kit for this build, and say so once
    expect(palaceTileParts('lastkeep', 'wall')).toBeUndefined();
    expect(palaceTileParts('lastkeep', 'wall_cracked')).toBeUndefined();
    expect(palaceSlabMaterial('lastkeep')).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(WALL_URL);
    // the modules that did arrive draw painted
    expect(palaceTileParts('lastkeep', 'pillar')).toHaveLength(1);

    // still offline: the next build asks again, and only for what is missing
    mocks.loadGltf.mockClear();
    await ensurePalaceTileAssets('dawnhold');
    expect(requestedUrls()).toEqual([WALL_URL]);
    expect(palaceTileParts('dawnhold', 'wall')).toBeUndefined();

    // back online: the build after that wears the painted wall
    offline.clear();
    mocks.loadGltf.mockClear();
    await ensurePalaceTileAssets('lastkeep');
    expect(requestedUrls()).toEqual([WALL_URL]);
    expect(palaceTileParts('lastkeep', 'wall')).toHaveLength(1);
    expect(palaceTileParts('lastkeep', 'wall_cracked')).toHaveLength(1);
    expect(palaceSlabMaterial('lastkeep')).toBeDefined();

    // a complete kit is never fetched twice
    mocks.loadGltf.mockClear();
    await ensurePalaceTileAssets('dawnhold');
    await ensurePalaceTileAssets('lastkeep');
    expect(mocks.loadGltf).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('refuses a module whose mesh carries a material list, by name', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const listed = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 1), [
      kitMaterial('eh_ashlar', 0xffffff),
      kitMaterial('eh_glass', 0xffffff),
    ]);
    listed.name = 'castle_wall_window_L0';
    const scene = new THREE.Group();
    scene.add(listed);
    serveModules({ [WINDOW_URL]: scene });

    await ensurePalaceTileAssets('dawnhold');

    // never drawn with its first material over the whole module
    expect(palaceTileParts('dawnhold', 'wall_archedwindow_gated')).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    const [message, error] = warn.mock.calls[0];
    expect(String(message)).toContain(WINDOW_URL);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      `palace tile kit: ${WINDOW_URL} mesh "castle_wall_window_L0" carries 2 materials, a module ships one material per mesh`,
    );
    // the rest of the kit is untouched by the one bad module
    expect(palaceTileParts('dawnhold', 'wall')).toHaveLength(1);
  });
});
