import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SCENERY_DETAIL_BANDS } from '../src/render/gfx';
import { SceneryDetailSession } from '../src/render/scenery_detail';
import { sceneryFullDistance, sceneryReduction } from '../src/render/scenery_detail_core';

const queue = { run: async <T>(work: () => T | Promise<T>): Promise<T> => work() };

describe('higher preset scenery loading', () => {
  it('never resurrects disposed cell draws when a pending preparation gate releases', async () => {
    const root = new THREE.Group();
    const geometry = new THREE.SphereGeometry(1, 12, 8);
    const material = new THREE.MeshStandardMaterial();
    const sources = [10, 20].map((x) => {
      const mesh = new THREE.InstancedMesh(geometry, material, 1);
      mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(x, 0, 0));
      root.add(mesh);
      return mesh;
    });
    let release!: () => void;
    let entered!: () => void;
    const gated = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let gates = 0;
    const session = new SceneryDetailSession(queue, SCENERY_DETAIL_BANDS.medium, {
      camera: new THREE.PerspectiveCamera(),
      gate: async () => {
        gates++;
        entered();
        await held;
      },
    });
    session.prepareRoot(root);
    await session.settled();
    session.update(0, 0);
    await gated;
    expect(sources.some((mesh) => mesh.children.length > 0)).toBe(true);
    session.dispose();
    release();
    for (let i = 0; i < 20 && session.snapshot().pending; i++) await Promise.resolve();
    expect(session.snapshot().pending).toBe(0);
    expect(gates).toBe(1);
    expect(root.children).toEqual(sources);
    for (const mesh of sources) {
      expect(mesh.count).toBe(1);
      expect(mesh.geometry).toBe(geometry);
      expect(mesh.children).toHaveLength(0);
    }
  });

  it.each(['medium', 'high', 'ultra', 'insane'] as const)(
    '%s removes small distant colour instances, preserves their shadows and restores them on approach',
    async (tier) => {
      const bands = SCENERY_DETAIL_BANDS[tier];
      const edge = sceneryFullDistance(bands);
      const geometry = new THREE.SphereGeometry(1, 12, 8);
      const material = new THREE.MeshStandardMaterial();
      const mesh = new THREE.InstancedMesh(geometry, material, 2);
      mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(20, 0, 0));
      mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(edge + 30, 0, 0));
      mesh.castShadow = mesh.receiveShadow = true;
      const original = Array.from(mesh.instanceMatrix.array);
      const root = new THREE.Group();
      root.add(mesh);
      const session = new SceneryDetailSession(queue, bands);
      session.prepareRoot(root);
      await session.settled();
      session.update(0, 0);
      const children = mesh.children as THREE.InstancedMesh[];
      expect(children.reduce((sum, child) => sum + child.count, 0)).toBe(1);
      expect(session.snapshot().levels[6]).toBe(1);
      for (const child of children) {
        expect(child.material).toBe(material);
        expect(child.receiveShadow).toBe(true);
      }
      const args = [null, mesh, null, null, mesh.geometry, null, null] as unknown as Parameters<
        typeof mesh.onBeforeShadow
      >;
      mesh.onBeforeShadow(...args);
      expect(mesh.count).toBe(2);
      expect(mesh.geometry.index).toBe(geometry.index);
      mesh.onAfterShadow(...args);
      expect(mesh.count).toBe(0);
      expect(Array.from(mesh.instanceMatrix.array)).toEqual(original);
      session.update(40, 0);
      expect(children.reduce((sum, child) => sum + child.count, 0)).toBe(2);
      session.dispose();
      expect(mesh.count).toBe(2);
    },
  );

  it('keeps multipart landmarks together while removing whole small objects', async () => {
    const root = new THREE.Group();
    const tree = new THREE.Group();
    const material = new THREE.MeshStandardMaterial();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 12, 12), material);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 8), material);
    crown.position.y = 10;
    tree.add(trunk, crown);
    tree.position.x = 180;
    const small = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material);
    small.position.x = 180;
    small.castShadow = true;
    root.add(tree, small);
    const original = small.geometry;
    const session = new SceneryDetailSession(queue, SCENERY_DETAIL_BANDS.medium);
    session.prepareRoot(root);
    await session.settled();
    session.update(0, 0);
    expect(session.snapshot().levels[6]).toBe(1);
    expect(small.geometry.drawRange.count).toBe(0);
    expect((small.children[0] as THREE.Mesh).visible).toBe(false);
    expect(trunk.visible).toBe(true); // Grouped source geometry retains its native path.
    expect(crown.geometry.drawRange.count > 0 || crown.children[0].visible).toBe(true);
    const args = [null, small, null, null, small.geometry, null, null] as unknown as Parameters<
      typeof small.onBeforeShadow
    >;
    small.onBeforeShadow(...args);
    expect(small.geometry.drawRange.count).toBe(Infinity);
    small.onAfterShadow(...args);
    expect(small.geometry.drawRange.count).toBe(0);
    session.update(170, 0);
    expect(small.geometry).toBe(original);
    session.dispose();
  });

  it('caps costly source parts instead of retaining a percentage of their original cost', () => {
    expect(
      [1, 2, 3, 4, 5].map((level) => sceneryReduction(level, 100000, false).triangles),
    ).toEqual([2048, 1024, 512, 32, 12]);
    expect([2, 3, 4, 5].map((level) => sceneryReduction(level, 100000, true).triangles)).toEqual([
      512, 256, 32, 12,
    ]);
    expect(sceneryReduction(2, 100, false).triangles).toBe(100);
  });
});
