// The Hammer vein's painted kit loader (src/render/smith_heart/hammer_env_kit.ts) with its
// second file, the Quarry's colossi: the kit settles with its own file alone, the statues
// ride along only if they landed first (a trailing or failed statue file costs only the
// statues, never the vein's paint), a statue file that trails is dropped rather than baked
// in a live frame, and the warmers the interior builds carry every painting a late kit
// build can bring in. The fetch is stubbed; each case loads the module fresh.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetches = vi.hoisted(() => ({
  pending: new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>(),
  released: [] as string[],
}));

vi.mock('../src/render/assets/loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/assets/loader')>()),
  loadGltf: (url: string) =>
    new Promise((resolve, reject) => fetches.pending.set(url, { resolve, reject })),
  releaseGltf: (url: string) => {
    fetches.released.push(url);
  },
}));

type Kit = typeof import('../src/render/smith_heart/hammer_env_kit');

const KIT_URL = '/models/props/smith_heart_hammer_env_kit.glb';
const COLOSSI_URL = '/models/props/smith_heart_hammer_colossi.glb';

/** A loaded file holding one top-level piece of one painting. */
function gltf(node: string, material: string) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  geometry.setAttribute(
    'normal',
    new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3),
  );
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ name: material }));
  const piece = new THREE.Object3D();
  piece.name = node;
  piece.add(mesh);
  const scene = new THREE.Group();
  scene.add(piece);
  return { scene };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function freshKit(): Promise<{ kit: Kit; ready: Promise<void> }> {
  vi.resetModules();
  fetches.pending.clear();
  fetches.released.length = 0;
  const kit = await import('../src/render/smith_heart/hammer_env_kit');
  const ready = kit.ensureHammerEnvKit();
  await settle();
  return { kit, ready };
}

const land = (url: string, file: ReturnType<typeof gltf>) =>
  fetches.pending.get(url)?.resolve(file);

beforeEach(() => {
  // The loader runs only in a page: the kit is never fetched under Node otherwise.
  vi.stubGlobal('window', globalThis);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the painted kit loader and its colossi', () => {
  it('fetches both files at once, at the raid door', async () => {
    await freshKit();
    expect([...fetches.pending.keys()].sort()).toEqual([COLOSSI_URL, KIT_URL].sort());
  });

  it('takes the statues along when they land before the kit', async () => {
    const { kit, ready } = await freshKit();
    land(COLOSSI_URL, gltf('Env_ColossusKeeper', 'env_colossus_keeper'));
    await settle();
    expect(kit.hammerEnvKitReady()).toBe(false);
    land(KIT_URL, gltf('Env_Block', 'tripo_material_env_block'));
    await ready;
    expect(kit.hammerEnvKitReady()).toBe(true);
    expect(kit.hammerEnvHas('Env_Block')).toBe(true);
    expect(kit.hammerEnvHas('Env_ColossusKeeper')).toBe(true);
  });

  it('settles with the kit while the statue file is still on the wire, and drops it after', async () => {
    const { kit, ready } = await freshKit();
    land(KIT_URL, gltf('Env_Block', 'tripo_material_env_block'));
    // The statues never arrive: the kit is ready all the same, the old colossi stand.
    await ready;
    expect(kit.hammerEnvKitReady()).toBe(true);
    expect(kit.hammerEnvHas('Env_ColossusKeeper')).toBe(false);
    // ...and when they do, they are released unbaked: no later build changes what it draws.
    land(COLOSSI_URL, gltf('Env_ColossusKeeper', 'env_colossus_keeper'));
    await settle();
    expect(kit.hammerEnvHas('Env_ColossusKeeper')).toBe(false);
    expect(fetches.released).toContain(COLOSSI_URL);
  });

  it('costs only the statues when their file fails', async () => {
    const { kit, ready } = await freshKit();
    fetches.pending.get(COLOSSI_URL)?.reject(new Error('404'));
    land(KIT_URL, gltf('Env_Block', 'tripo_material_env_block'));
    await ready;
    expect(kit.hammerEnvKitReady()).toBe(true);
    expect(kit.hammerEnvHas('Env_Block')).toBe(true);
    expect(kit.hammerEnvHas('Env_ColossusKeeper')).toBe(false);
  });

  it('is not ready when the kit itself fails, whatever the statues did', async () => {
    const { kit, ready } = await freshKit();
    land(COLOSSI_URL, gltf('Env_ColossusKeeper', 'env_colossus_keeper'));
    await settle();
    fetches.pending.get(KIT_URL)?.reject(new Error('404'));
    await ready;
    expect(kit.hammerEnvKitReady()).toBe(false);
  });

  it('warms one hidden instanced carrier per landed painting, and the flames off the low tier', async () => {
    const { kit, ready } = await freshKit();
    land(COLOSSI_URL, gltf('Env_ColossusKeeper', 'env_colossus_keeper'));
    await settle();
    land(KIT_URL, gltf('Env_Block', 'tripo_material_env_block'));
    await ready;
    for (const lowGfx of [false, true]) {
      const warm = kit.hammerEnvProgramWarmers(lowGfx);
      const carriers = warm.children.filter((o) => o instanceof THREE.InstancedMesh);
      expect(carriers.map((m) => m.name).sort()).toEqual([
        'smithHeartHammerEnvWarmer:block',
        'smithHeartHammerEnvWarmer:env_colossus_keeper',
      ]);
      for (const m of carriers as THREE.InstancedMesh[]) {
        const painting = m.name.split(':')[1];
        // The pieces' own material and variant: instanced, casting and taking shadow.
        expect(m.material).toBe(kit.hammerEnvMaterial(painting));
        expect(m.castShadow && m.receiveShadow).toBe(true);
        expect(m.visible).toBe(false);
      }
      const flames = warm.getObjectByName('smithHeartHammerEnvWarmer:flames');
      expect(flames !== undefined).toBe(!lowGfx);
    }
  });

  it('draws the statues on the stone paintings program, not the rock cutaway or the strokes', async () => {
    const { kit } = await freshKit();
    const key = (painting: string) => kit.hammerEnvMaterial(painting).customProgramCacheKey();
    for (const statue of ['env_colossus_keeper', 'env_colossus_waking', 'env_colossus_bearer']) {
      expect(kit.hammerEnvPaintingOf(statue)).toBe(statue);
      expect(key(statue), statue).toBe(key('block'));
      expect(key(statue), statue).not.toBe(key('cliff_tall'));
    }
  });
});
