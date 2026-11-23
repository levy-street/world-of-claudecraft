import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

// The editor's Materials panel lists a placed model's material slots through
// PlacedAssetsView.materialSlots. An ordinary static prop draws from the
// instanced batches, where its live `model` is an empty proxy: its slots must
// still come back (from the template its clone is struck from), or the panel
// waits on "still loading" forever and the prop can never get a first finish.
const template = new THREE.Group();
const walls = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });
walls.name = 'Walls';
const roof = new THREE.MeshStandardMaterial({ color: 0x663322 });
roof.name = 'Roof';
template.add(
  new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), walls),
  new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 1), roof),
);

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: async () => ({ scene: template }),
}));
vi.mock('../src/render/assets/preload', () => ({
  registerPreload: () => {},
  registerDeferredPreload: () => {},
}));

const { PlacedAssetsView } = await import('../src/render/placed_assets');

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('material slots of a placed model', () => {
  it('lists a batched prop by its template materials', async () => {
    const view = new PlacedAssetsView([], 7);
    expect(view.materialSlots(0)).toBeNull();
    view.addPlacement(0, { path: '/models/house.glb', x: 0, z: 0, rotY: 0, scale: 1 });
    await settle();
    expect(view.batchStats().batched).toBe(1);
    expect(view.materialSlots(0)?.map((s) => s.key)).toEqual(['Walls', 'Roof']);
    // The first finish un-batches it: the slots stay listed while the clone
    // is rebuilt (the editor's panel re-renders in that same turn).
    view.updatePlacement(0, { materialFinishes: { Roof: { color: 0x224466 } } });
    expect(view.materialSlots(0)?.map((s) => s.key)).toEqual(['Walls', 'Roof']);
    await settle();
    expect(view.batchStats().batched).toBe(0);
    expect(view.materialSlots(0)?.map((s) => s.key)).toEqual(['Walls', 'Roof']);
    view.dispose();
  });

  it('lists a cloned (finished) prop by its own materials', async () => {
    const view = new PlacedAssetsView([], 7);
    view.addPlacement(0, {
      path: '/models/house.glb',
      x: 0,
      z: 0,
      rotY: 0,
      scale: 1,
      materialFinishes: { Roof: { color: 0x224466 } },
    });
    await settle();
    expect(view.batchStats().batched).toBe(0);
    expect(view.materialSlots(0)?.map((s) => s.key)).toEqual(['Walls', 'Roof']);
    view.dispose();
  });
});
