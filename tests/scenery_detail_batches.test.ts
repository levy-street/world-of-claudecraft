import * as THREE from 'three';
import { WebGLGeometries } from 'three/src/renderers/webgl/WebGLGeometries.js';
import { describe, expect, it, vi } from 'vitest';
import { SceneryDetailBatches } from '../src/render/scenery_detail_batches';
import { freezeStaticSubtreeMatrices } from '../src/render/static_matrix';

function fixture() {
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshStandardMaterial();
  const children: THREE.InstancedMesh[] = [];
  for (const x of [-2, 2]) {
    const owner = new THREE.InstancedMesh(geometry, material, 1);
    owner.setMatrixAt(0, new THREE.Matrix4().makeTranslation(x, 0, -10));
    owner.count = 0;
    owner.castShadow = true;
    const child = new THREE.InstancedMesh(geometry, material, 1);
    child.setMatrixAt(0, new THREE.Matrix4().makeTranslation(x, 0, -10));
    child.setColorAt(0, new THREE.Color(x < 0 ? 'red' : 'blue'));
    child.receiveShadow = true;
    child.computeBoundingSphere();
    owner.add(child);
    root.add(owner);
    children.push(child);
  }
  root.updateMatrixWorld(true);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.updateMatrixWorld(true);
  const owners = children.map((child) => child.parent as THREE.InstancedMesh);
  return { root, children, owners, geometry, material, camera };
}

describe('scenery cell draw consolidation', () => {
  it('places gated pooled draws in their frozen parent frame before revealing them', async () => {
    const f = fixture();
    const scene = new THREE.Scene();
    scene.matrixAutoUpdate = false;
    scene.add(f.root);
    f.root.position.set(80, 12, 70);
    f.root.rotation.y = Math.PI / 3;
    f.root.scale.set(2, 3, 4);
    for (const owner of f.owners) {
      owner.position.set(4, 2, -3);
      owner.rotation.y = -Math.PI / 4;
    }
    freezeStaticSubtreeMatrices(f.root);
    scene.updateMatrixWorld();
    const expected = f.owners[0].matrixWorld.clone();
    const batches = new SceneryDetailBatches(f.children);
    try {
      await batches.prepare(async (mesh) => {
        // GPU preparation can bake the standalone mesh before its final attach.
        mesh.updateMatrixWorld(true);
      });
      const pooled = f.root.getObjectByName('scenery-batched') as THREE.InstancedMesh;
      expect(pooled).toBeDefined();
      expect(pooled.visible).toBe(false);
      expect(pooled.matrixWorld.elements).toEqual(expected.elements);
      scene.updateMatrixWorld();
      expect(pooled.matrixWorld.elements).toEqual(expected.elements);
      expect(pooled.matrixAutoUpdate).toBe(false);
      expect(f.root.matrixWorldAutoUpdate).toBe(false);
    } finally {
      batches.dispose();
      f.geometry.dispose();
      f.material.dispose();
    }
  });

  it('reintroduces empty cells with their current material and transform data', async () => {
    const f = fixture();
    const batches = new SceneryDetailBatches(f.children);
    await batches.prepare(async () => undefined);
    batches.update(f.camera);
    const pooled = f.root.getObjectByName('scenery-batched') as THREE.InstancedMesh;
    for (const child of f.children) child.count = 0;
    batches.update(f.camera);
    expect(pooled.count).toBe(0);
    expect(pooled.visible).toBe(false);
    const faded = f.material.clone();
    f.children[0].material = faded;
    batches.update(f.camera);
    f.children[0].count = 1;
    f.children[1].count = 1;
    f.children[1].setMatrixAt(0, new THREE.Matrix4().makeTranslation(4, 0, -10));
    f.children[1].instanceMatrix.needsUpdate = true;
    batches.update(f.camera);
    expect(pooled.count).toBe(1);
    expect(pooled.instanceMatrix.array[12]).toBe(4);
    expect(f.children[0].parent).toBe(f.owners[0]);
    expect(f.children[0].visible).toBe(true);
    expect(f.children[0].material).toBe(faded);
    batches.dispose();
  });

  it('frees reduced GPU buffers when only the pooled draw ever rendered, after its final owner retires', async () => {
    const f = fixture();
    const sourcePosition = f.geometry.attributes.position;
    const reducedIndex = f.geometry.index!.clone();
    const reducedPosition = sourcePosition.clone();
    const reduced = new THREE.BufferGeometry();
    reduced.attributes = { ...f.geometry.attributes, position: reducedPosition };
    reduced.index = reducedIndex;
    for (const child of f.children) child.geometry = reduced;
    const removed = new Set<THREE.BufferAttribute>();
    const geometries = (
      WebGLGeometries as unknown as (...args: unknown[]) => {
        get(object: THREE.Object3D, geometry: THREE.BufferGeometry): THREE.BufferGeometry;
      }
    )(
      {},
      { remove: (attribute: THREE.BufferAttribute) => removed.add(attribute) },
      { memory: { geometries: 0 } },
      { releaseStatesOfGeometry: () => undefined },
    );
    const batches = new SceneryDetailBatches(f.children);
    await batches.prepare(async () => undefined);
    batches.update(f.camera);
    const pooled = f.root.getObjectByName('scenery-batched') as THREE.InstancedMesh;
    geometries.get(pooled, pooled.geometry);
    batches.retire();
    expect(removed.size).toBe(0);
    expect(pooled.instanceMatrix.array.length).toBe(0);
    expect(pooled.instanceColor).toBeNull();
    batches.dispose(new Set([reducedIndex, reducedPosition]));
    expect(removed.has(reducedIndex)).toBe(true);
    expect(removed.has(reducedPosition)).toBe(true);
    expect(removed.has(sourcePosition as THREE.BufferAttribute)).toBe(false);
    expect(removed.has(f.geometry.attributes.normal as THREE.BufferAttribute)).toBe(false);
  });
  it('gates one shared draw, preserves source shader inputs, colours and shadow owners', async () => {
    const f = fixture();
    const batches = new SceneryDetailBatches(f.children);
    let release!: () => void;
    const preparing = batches.prepare(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    batches.update(f.camera);
    expect(f.children.every((child) => child.visible)).toBe(true);
    expect(f.root.children).toHaveLength(2);
    release();
    await preparing;
    batches.update(f.camera);
    const merged = f.root.getObjectByName('scenery-batched') as THREE.InstancedMesh;
    expect(merged.count).toBe(2);
    expect(merged.material).toBe(f.material);
    expect(merged.geometry.attributes.normal).toBe(f.geometry.attributes.normal);
    expect(merged.geometry.attributes.uv).toBe(f.geometry.attributes.uv);
    expect(merged.receiveShadow).toBe(true);
    expect(merged.castShadow).toBe(false);
    expect(Array.from(merged.instanceMatrix.array)).toEqual(
      f.children.flatMap((child) => Array.from(child.instanceMatrix.array)),
    );
    expect(Array.from(merged.instanceColor!.array)).toEqual(
      f.children.flatMap((child) => Array.from(child.instanceColor!.array)),
    );
    expect(f.children.every((child) => !child.visible)).toBe(true);
    for (const owner of f.owners) {
      expect(owner.castShadow).toBe(true);
      expect(owner.count).toBe(0);
      expect(owner.children).toHaveLength(0);
    }
    const version = merged.instanceMatrix.version;
    batches.update(f.camera);
    expect(merged.instanceMatrix.version).toBe(version);
    f.owners[0].visible = false;
    batches.update(f.camera);
    expect(merged.count).toBe(1);
    expect(merged.instanceMatrix.array[12]).toBe(2);
    f.owners[0].visible = true;
    const faded = f.material.clone();
    f.children[0].material = faded;
    batches.update(f.camera);
    expect(merged.count).toBe(1);
    expect(f.children[0].visible).toBe(true);
    expect(f.children[0].parent).toBe(f.owners[0]);
    batches.dispose();
    expect(f.children.every((child) => child.visible)).toBe(true);
    expect(f.root.children).toHaveLength(2);
  });

  it('retains per-cell frustum rejection in the shared draw', async () => {
    const f = fixture();
    f.children[0].boundingSphere!.center.x = 1000;
    const batches = new SceneryDetailBatches(f.children);
    await batches.prepare(async () => undefined);
    batches.update(f.camera);
    const merged = f.root.getObjectByName('scenery-batched') as THREE.InstancedMesh;
    expect(merged.count).toBe(1);
    expect(merged.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 16 }]);
    expect(merged.instanceColor!.updateRanges).toEqual([{ start: 0, count: 3 }]);
    expect(merged.instanceMatrix.array[12]).toBe(2);
    batches.dispose();
  });

  it('rebuilds from detached cells and never lets an older generation reattach active cells', async () => {
    const f = fixture();
    const owners = new Map(f.children.map((child, i) => [child, f.owners[i]]));
    const first = new SceneryDetailBatches(f.children, owners);
    await first.prepare(async () => undefined);
    first.update(f.camera);
    expect(f.children.every((child) => child.parent === null)).toBe(true);
    const second = new SceneryDetailBatches(f.children, owners);
    await second.prepare(async () => undefined);
    first.retire();
    second.update(f.camera);
    expect(second.snapshot().draws).toBe(1);
    expect(f.children.every((child) => child.parent === null)).toBe(true);
    first.dispose();
    expect(f.children.every((child) => child.parent === null)).toBe(true);
    second.dispose();
    expect(f.children.every((child, i) => child.parent === f.owners[i])).toBe(true);
  });

  it('defers cancellation disposal until the gate releases and never disposes borrowed geometry or materials', async () => {
    const f = fixture();
    const geometryDisposed = vi.fn(),
      materialDisposed = vi.fn(),
      ownedDisposed = vi.fn();
    f.geometry.addEventListener('dispose', geometryDisposed);
    f.material.addEventListener('dispose', materialDisposed);
    const batches = new SceneryDetailBatches(f.children);
    let release!: () => void;
    const preparing = batches.prepare(async (root) => {
      (root as THREE.Mesh).geometry.addEventListener('dispose', ownedDisposed);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    batches.dispose();
    expect(ownedDisposed).not.toHaveBeenCalled();
    release();
    await preparing;
    expect(ownedDisposed).toHaveBeenCalledTimes(1);
    expect(geometryDisposed).not.toHaveBeenCalled();
    expect(materialDisposed).not.toHaveBeenCalled();
    expect(f.root.children).toHaveLength(2);
  });
});
