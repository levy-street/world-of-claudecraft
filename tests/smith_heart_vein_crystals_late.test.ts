// The vein crystals when their model lands AFTER the interior was built (the fetch outran
// the interior's wait): they join the interior's group hidden, behind the live compile
// gate, and show once their program has linked; an interior that is gone by then gets
// nothing. Its own file: it holds the loader on a promise the cases resolve, and reads the
// painter's module state from fresh.

import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loads: { url: string; resolve: (gltf: unknown) => void; reject: (e: unknown) => void }[] = [];
const released: string[] = [];

vi.mock('../src/render/assets/loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/assets/loader')>()),
  loadGltf: (url: string) =>
    new Promise((resolve, reject) => {
      loads.push({ url, resolve, reject });
    }),
  releaseGltf: (url: string) => {
    released.push(url);
  },
}));

import { setHeartKitCompileGate } from '../src/render/smith_heart/heart_kit';
import { newHeartSealView } from '../src/render/smith_heart/heart_seal_core';
import {
  SMITH_HEART_VEIN_CRYSTALS_URL,
  veinCrystalNodes,
} from '../src/render/smith_heart/vein_crystal_core';
import { SMITH_HEART_VEINS } from '../src/sim/content/smith_heart_layout';

/** The file's scene, built by hand: each vein's two nodes on one painted material. */
function scene(): THREE.Group {
  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
  for (const vein of SMITH_HEART_VEINS) {
    const names = veinCrystalNodes(vein);
    for (const name of [names.collar, names.crystal]) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
      mesh.name = name;
      root.add(mesh);
    }
  }
  return root;
}

const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

async function freshPainter() {
  vi.resetModules();
  loads.length = 0;
  released.length = 0;
  return import('../src/render/smith_heart/vein_crystal');
}

describe('the vein crystals, when the model lands after the interior', () => {
  beforeEach(() => {
    setHeartKitCompileGate(null);
  });

  it('joins the interior hidden behind the compile gate, and shows once it has linked', async () => {
    const { buildVeinCrystals } = await freshPainter();
    const { setHeartKitCompileGate: setGate } = await import('../src/render/smith_heart/heart_kit');
    const gated: THREE.Object3D[] = [];
    let open: () => void = () => {};
    setGate((target) => {
      gated.push(target);
      return new Promise<void>((resolve) => {
        open = resolve;
      });
    });
    const interior = new THREE.Group();
    const crystals = buildVeinCrystals();
    interior.add(crystals.group);
    // Not landed: nothing stands yet, the fetch is out, and a frame's update is harmless.
    expect(crystals.group.children).toHaveLength(0);
    expect(loads.map((l) => l.url)).toEqual([`/${SMITH_HEART_VEIN_CRYSTALS_URL}`]);
    const view = newHeartSealView();
    crystals.update(view);

    loads[0].resolve({ scene: scene() });
    await settle();
    // Landed: every vein's pair is under the group, the whole of it hidden until the gate
    // has linked its program, and the parse is handed back to the cache.
    const root = crystals.group.children[0];
    expect(root?.name).toBe('veinCrystals');
    expect(root.children).toHaveLength(SMITH_HEART_VEINS.length);
    expect(root.visible).toBe(false);
    expect(gated).toEqual([root]);
    expect(released).toEqual([`/${SMITH_HEART_VEIN_CRYSTALS_URL}`]);
    // A guardian falling while the gate is still linking is not lost.
    view.since[SMITH_HEART_VEINS.indexOf('heat')] = 999;
    crystals.update(view);
    expect(root.visible).toBe(false);

    open();
    await settle();
    expect(root.visible).toBe(true);
    const heat = root.getObjectByName('veinCrystal:heat:crystal') as THREE.Mesh;
    const hammer = root.getObjectByName('veinCrystal:hammer:crystal') as THREE.Mesh;
    expect(heat.visible).toBe(true);
    expect(heat.scale.y).toBe(1);
    expect(hammer.visible).toBe(false);
  });

  it('shows at once where no gate is installed, and builds once however many landings', async () => {
    const { buildVeinCrystals } = await freshPainter();
    const interior = new THREE.Group();
    const crystals = buildVeinCrystals();
    interior.add(crystals.group);
    loads[0].resolve({ scene: scene() });
    await settle();
    expect(crystals.group.children).toHaveLength(1);
    expect(crystals.group.children[0].visible).toBe(true);
    // The next interior of the session finds the model resident and builds with it.
    const again = buildVeinCrystals();
    expect(again.group.children).toHaveLength(1);
    expect(again.group.children[0].visible).toBe(true);
    expect(loads).toHaveLength(1);
  });

  it('gives nothing to an interior that was torn down before the model landed', async () => {
    const { buildVeinCrystals } = await freshPainter();
    const crystals = buildVeinCrystals();
    loads[0].resolve({ scene: scene() });
    await settle();
    expect(crystals.group.children).toHaveLength(0);
  });

  it('a model that never lands leaves the interior as it was, and is not asked for twice', async () => {
    const { buildVeinCrystals, ensureVeinCrystals } = await freshPainter();
    const interior = new THREE.Group();
    const crystals = buildVeinCrystals();
    interior.add(crystals.group);
    loads[0].reject(new Error('offline'));
    await settle();
    expect(crystals.group.children).toHaveLength(0);
    crystals.update(newHeartSealView());
    await expect(ensureVeinCrystals()).resolves.toBeUndefined();
    expect(buildVeinCrystals().group.children).toHaveLength(0);
    expect(loads).toHaveLength(1);
  });
});
