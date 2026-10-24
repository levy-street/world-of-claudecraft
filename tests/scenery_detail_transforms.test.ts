import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SCENERY_DETAIL_BANDS } from '../src/render/gfx';
import { SceneryDetailSession } from '../src/render/scenery_detail';
import { freezeStaticSubtreeMatrices } from '../src/render/static_matrix';

const queue = { run: async <T>(work: () => T | Promise<T>): Promise<T> => work() };

describe('scenery detail placement under frozen parents', () => {
  it.each(['ordinary', 'instanced'] as const)(
    'places %s copies at their owner before the first draw and across detail changes',
    async (kind) => {
      const scene = new THREE.Scene();
      scene.matrixAutoUpdate = false;
      const root = new THREE.Group();
      root.position.set(80, 12, 70);
      root.rotation.y = Math.PI / 3;
      root.scale.set(2, 3, 4);
      scene.add(root);
      const geometry = new THREE.SphereGeometry(2, 32, 16);
      const material = new THREE.MeshStandardMaterial();
      const owner =
        kind === 'instanced'
          ? new THREE.InstancedMesh(geometry, material, 2)
          : new THREE.Mesh(geometry, material);
      owner.position.set(4, 2, -3);
      owner.rotation.y = -Math.PI / 4;
      owner.scale.setScalar(1.5);
      if (owner instanceof THREE.InstancedMesh) {
        owner.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 0, 0));
        owner.setMatrixAt(1, new THREE.Matrix4().makeTranslation(120, 0, 0));
      }
      root.add(owner);
      // Match the renderer: final source transforms, then attach detail copies.
      freezeStaticSubtreeMatrices(root);
      scene.updateMatrixWorld();
      const world = owner.matrixWorld.clone();
      const session = new SceneryDetailSession(queue, SCENERY_DETAIL_BANDS.medium);
      try {
        session.prepareRoot(root);
        expect(owner.children.length).toBeGreaterThan(0);
        const assertPlacement = () => {
          // Do not use getWorldPosition/Box3: their refresh could hide the bug.
          for (const child of owner.children) {
            expect(child.matrixWorld.elements).toEqual(world.elements);
            expect(child.matrixAutoUpdate).toBe(false);
          }
        };
        assertPlacement();
        await session.settled();
        const visibleBatches: string[][] = [];
        for (const x of [80, 800, 80]) {
          session.update(x, 70);
          scene.updateMatrixWorld();
          assertPlacement();
          if (owner instanceof THREE.InstancedMesh) {
            expect(owner.children.some((child) => child.visible)).toBe(true);
            visibleBatches.push(
              owner.children.filter((child) => child.visible).map((child) => child.name),
            );
          } else {
            // Nearby scenery draws its source; the copy owns the far detail.
            expect(owner.children[0].visible).toBe(x === 800);
            expect(owner.geometry === geometry).toBe(x !== 800);
          }
        }
        if (owner instanceof THREE.InstancedMesh) {
          expect(visibleBatches[1]).not.toEqual(visibleBatches[0]);
          expect(visibleBatches[2]).toEqual(visibleBatches[0]);
        }
        expect(owner.matrixWorld.elements).toEqual(world.elements);
        expect(root.matrixWorldAutoUpdate).toBe(false);
      } finally {
        session.dispose();
        geometry.dispose();
        material.dispose();
      }
      expect(owner.children).toHaveLength(0);
      expect(owner.geometry).toBe(geometry);
    },
  );
});
