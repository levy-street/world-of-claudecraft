import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The authored floors (the Infernal Citadel set piece, the rift floors, and the
// two walk-in palaces) share one decor table. A palace draws its own painted
// castle piece for a key; nobody else ever does, so nobody else may fetch one.

const mocks = vi.hoisted(() => ({ loadGltf: vi.fn() }));

vi.mock('../src/render/assets/loader', () => ({ loadGltf: mocks.loadGltf }));

const CITADEL_URLS = [
  '/models/props/rift_flame.glb',
  '/models/props/infernal_brazier.glb',
  '/models/props/infernal_altar.glb',
  '/models/props/demon_idol.glb',
  '/models/props/hell_forge.glb',
  '/models/props/hanging_cage.glb',
  '/models/props/bone_pile.glb',
  '/models/props/obsidian_fang.glb',
  '/models/props/infernal_statue.glb',
  '/models/props/slag_cauldron.glb',
  '/models/props/bone_throne.glb',
];

const PALACE_URLS = [
  '/models/biome/kcas_decor_brazier.glb',
  '/models/biome/kcas_decor_altar.glb',
  '/models/biome/kcas_decor_hearth.glb',
  '/models/biome/kcas_decor_cage.glb',
  '/models/biome/kcas_decor_rubble.glb',
  '/models/biome/kcas_decor_statue.glb',
  '/models/biome/kcas_decor_cauldron.glb',
  '/models/biome/kcas_decor_throne.glb',
];

const requestedUrls = (): string[] => mocks.loadGltf.mock.calls.map(([url]) => url as string);

/** A loaded model that carries its own url, so a build can be asked which
 *  file it drew a piece from. */
function modelScene(url: string): THREE.Group {
  const scene = new THREE.Group();
  scene.name = url;
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshStandardMaterial()));
  return scene;
}

// The module keeps what it has loaded for the life of the page, so every case
// imports its own copy.
async function freshRiftDecor(): Promise<typeof import('../src/render/rift_decor')> {
  vi.resetModules();
  return import('../src/render/rift_decor');
}

describe('authored-floor decor assets', () => {
  beforeEach(() => {
    mocks.loadGltf.mockReset();
    mocks.loadGltf.mockImplementation(async (url: string) => ({ scene: modelScene(url) }));
  });

  it('fetches no palace piece for the citadel and the rift floors', async () => {
    const { ensureInfernalDecorAssets } = await freshRiftDecor();
    await ensureInfernalDecorAssets();
    expect(requestedUrls().sort()).toEqual([...CITADEL_URLS].sort());
    expect(requestedUrls().filter((url) => url.includes('kcas_decor_'))).toEqual([]);
  });

  it('adds the eight painted pieces for a palace, beside the models it falls back to', async () => {
    const { ensureInfernalDecorAssets } = await freshRiftDecor();
    await ensureInfernalDecorAssets(true);
    expect(PALACE_URLS).toHaveLength(8);
    expect(requestedUrls().sort()).toEqual([...CITADEL_URLS, ...PALACE_URLS].sort());
  });

  it('fetches only the palace pieces when a palace follows a citadel, and each file once', async () => {
    const { ensureInfernalDecorAssets } = await freshRiftDecor();
    await ensureInfernalDecorAssets();
    mocks.loadGltf.mockClear();
    await ensureInfernalDecorAssets(true);
    expect(requestedUrls().sort()).toEqual([...PALACE_URLS].sort());
    mocks.loadGltf.mockClear();
    await ensureInfernalDecorAssets(true);
    await ensureInfernalDecorAssets();
    expect(mocks.loadGltf).not.toHaveBeenCalled();
  });

  it('draws the painted piece in a palace once it is loaded, and the citadel model until then', async () => {
    const { buildInfernalDecor, ensureInfernalDecorAssets } = await freshRiftDecor();
    const throne = [{ key: 'bone_throne', x: 0, z: 0, yaw: 0 }];
    const torch = { flame: 0xff6a2a, light: 0xff8a3a };
    const drawnFrom = (palace: boolean): string | undefined => {
      const group = new THREE.Group();
      buildInfernalDecor(group, throne, torch, () => {}, undefined, palace);
      return group.children[0]?.children[0]?.name;
    };

    await ensureInfernalDecorAssets();
    expect(drawnFrom(false)).toBe('/models/props/bone_throne.glb');
    // a palace whose pieces were never asked for falls back, so the flag on the
    // load has to match the flag on the build
    expect(drawnFrom(true)).toBe('/models/props/bone_throne.glb');

    await ensureInfernalDecorAssets(true);
    expect(drawnFrom(true)).toBe('/models/biome/kcas_decor_throne.glb');
    expect(drawnFrom(false)).toBe('/models/props/bone_throne.glb');
  });

  it('is asked for the palace pieces by the interior builder only when the variant is a palace', () => {
    // the builder as code: comments cut, so a commented-out call can satisfy neither pin
    const dungeon = readFileSync(new URL('../src/render/dungeon.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    // one call site, and it passes the palace test of the variant being built
    expect(dungeon.match(/ensureInfernalDecorAssets\(/g)).toHaveLength(1);
    expect(dungeon).toContain('await ensureInfernalDecorAssets(isPalaceVariant(variant));');
  });
});
