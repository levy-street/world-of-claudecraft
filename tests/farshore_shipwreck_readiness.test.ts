import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/assets/loader', () => ({ loadGltf: vi.fn() }));

describe('shipwreck scenery preparation', () => {
  it.each(['shipwreck', 'hull_fragment'])(
    'waits for a delayed %s before revealing scenery',
    async (delayed) => {
      vi.resetModules();
      const { loadGltf } = await import('../src/render/assets/loader');
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.mocked(loadGltf).mockImplementation(async (url) => {
        if (url.endsWith(`/${delayed}.glb`)) await waiting;
        const scene = new THREE.Group();
        scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
        return { scene } as Awaited<ReturnType<typeof loadGltf>>;
      });
      const { buildFarshoreShipwreck, prepareFarshoreShipwreck } = await import(
        '../src/render/farshore_shipwreck'
      );
      const { isWorldQuestPlacerAssetReady } = await import(
        '../src/render/world_quest_placer_assets'
      );
      const preparation = prepareFarshoreShipwreck();
      try {
        await vi.waitFor(() =>
          expect(
            isWorldQuestPlacerAssetReady(
              delayed === 'shipwreck' ? 'wq_hull_fragment' : 'wq_shipwreck',
            ),
          ).toBe(true),
        );
        expect(buildFarshoreShipwreck()).toBeNull();
      } finally {
        release();
        await preparation;
      }
      expect(buildFarshoreShipwreck()?.children.map((part) => part.name)).toEqual([
        'farshore-broken-ship',
        'farshore-broken-hull',
      ]);
    },
  );
});
