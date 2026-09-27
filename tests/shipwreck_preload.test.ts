import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { loadGltf } from '../src/render/assets/loader';
import {
  assetsReady,
  beginDeferredPreloads,
  preloadInternalsForTest,
} from '../src/render/assets/preload';

vi.mock('../src/render/assets/loader', () => ({
  loadGltf: vi.fn(async () => {
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    return { scene };
  }),
}));

describe('shipwreck runtime boot preload', () => {
  it('defers all seven shared models until world entry and prepares every runtime body', async () => {
    preloadInternalsForTest.reset();
    const ship = await import('../src/render/farshore_shipwreck');
    const salvage = await import('../src/render/farshore_salvage_assets');
    expect(loadGltf).not.toHaveBeenCalled();
    expect(ship.buildFarshoreShipwreck()).toBeNull();
    expect(beginDeferredPreloads()).toBeGreaterThan(0);
    await assetsReady();
    expect(
      vi
        .mocked(loadGltf)
        .mock.calls.map(([url]) => url)
        .sort(),
    ).toEqual([
      '/models/world_quests/shipwreck/broken_planks.glb',
      '/models/world_quests/shipwreck/capsized_rowboat.glb',
      '/models/world_quests/shipwreck/damaged_crate.glb',
      '/models/world_quests/shipwreck/fallen_anchor.glb',
      '/models/world_quests/shipwreck/hull_fragment.glb',
      '/models/world_quests/shipwreck/shipwreck.glb',
      '/models/world_quests/shipwreck/waterlogged_barrel.glb',
    ]);
    expect(ship.buildFarshoreShipwreck()?.children).toHaveLength(2);
    for (const entry of salvage.farshoreSalvagePrewarmPlan) {
      expect(
        salvage.buildFarshoreSalvageObject(entry.itemId, entry.entityId)?.group.children,
      ).toHaveLength(1);
    }
  });
});
