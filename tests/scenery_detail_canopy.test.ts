import * as THREE from 'three';
import { WebGLGeometries } from 'three/src/renderers/webgl/WebGLGeometries.js';
import { WebGLObjects } from 'three/src/renderers/webgl/WebGLObjects.js';
import { describe, expect, it } from 'vitest';
import { SCENERY_DETAIL_BANDS } from '../src/render/gfx';
import { SceneryDetailSession } from '../src/render/scenery_detail';
import { buildCanopyDetail } from '../src/render/scenery_detail_canopy';

// Disconnected leaf cards are real surfaces, not disposable mesh fragments.
function crown(): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let z = 0; z < 8; z++) {
    for (let x = 0; x < 8; x++) {
      const i = positions.length / 3;
      positions.push(x - 0.6, 0, z - 0.6, x + 0.6, 0, z - 0.6);
      positions.push(x + 0.6, 0, z + 0.6, x - 0.6, 0, z + 0.6);
      indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  return g;
}

describe('scenery canopy representations', () => {
  it('reduces separate cards across the entire crown instead of deleting a side', () => {
    const g = crown();
    const original = Array.from(g.attributes.position.array);
    let previous = g.index!.count;
    for (const level of [1, 2, 3, 4, 5]) {
      const detail = buildCanopyDetail(g, level, false)!;
      expect(detail.index.count).toBeLessThan(previous);
      previous = detail.index.count;
      const box = new THREE.Box3();
      for (const i of detail.index.array) {
        box.expandByPoint(new THREE.Vector3().fromBufferAttribute(detail.position, i));
      }
      expect(box.min.x).toBeLessThan(0.5);
      expect(box.min.z).toBeLessThan(0.5);
      expect(box.max.x).toBeGreaterThan(6.5);
      expect(box.max.z).toBeGreaterThan(6.5);
      const quadrants = new Set<number>();
      for (const i of detail.index.array) {
        quadrants.add(
          (detail.position.getX(i) > 3.5 ? 1 : 0) + (detail.position.getZ(i) > 3.5 ? 2 : 0),
        );
      }
      expect(quadrants.size).toBe(4);
    }
    expect(Array.from(g.attributes.position.array)).toEqual(original);
    expect(g.index!.count).toBe(64 * 6);
  });

  it('gives Palmreach a stronger crown budget and leaves connected surfaces to normal LOD', () => {
    const g = crown();
    expect(buildCanopyDetail(g, 3, true)!.index.count).toBeLessThan(
      buildCanopyDetail(g, 3, false)!.index.count,
    );
    expect(buildCanopyDetail(new THREE.SphereGeometry(2, 24, 12), 3, false)).toBeNull();
  });

  it('keeps source positions for externally count-managed far bakes with leaf materials', async () => {
    const geometry = crown();
    const material = new THREE.MeshStandardMaterial();
    material.name = 'Leaves_TwistedTree';
    const mesh = new THREE.InstancedMesh(geometry, material, 1);
    mesh.name = 'far-bake:leaves';
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(400, 0, 0));
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    mesh.count = 0;
    const session = new SceneryDetailSession({ run: async (fn) => fn() }, SCENERY_DETAIL_BANDS.low);
    session.prepare(mesh);
    await session.settled();
    session.update(0, 0);
    expect(mesh.geometry.getAttribute('position')).toBe(geometry.getAttribute('position'));
    expect(mesh.count).toBe(0);
    expect(session.snapshot().positionBytes).toBe(0);
    session.dispose();
  });

  it('uploads original shadow vertices on first far appearance and frees only owned buffers', async () => {
    const geometry = crown();
    const material = new THREE.MeshStandardMaterial();
    material.name = 'Leaves_TwistedTree';
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.x = 400;
    mesh.castShadow = true;
    const session = new SceneryDetailSession({ run: async (fn) => fn() }, SCENERY_DETAIL_BANDS.low);
    session.prepare(mesh);
    await session.settled();
    session.update(0, 0);
    const color = mesh.children[0] as THREE.Mesh;
    const sourcePosition = geometry.getAttribute('position');
    const reducedPosition = color.geometry.getAttribute('position');
    expect(reducedPosition).not.toBe(sourcePosition);
    const resident = new Set<unknown>();
    const removed = new Set<unknown>();
    const attributes = {
      update: (a: unknown) => resident.add(a),
      remove: (a: unknown) => {
        removed.add(a);
        resident.delete(a);
      },
    };
    const info = { memory: { geometries: 0 }, render: { frame: 1 } };
    const binding = { releaseStatesOfGeometry: () => undefined };
    const geometries = (WebGLGeometries as unknown as (...args: unknown[]) => unknown)(
      {},
      attributes,
      info,
      binding,
    );
    const objects = (
      WebGLObjects as unknown as (...args: unknown[]) => {
        update(mesh: THREE.Mesh): THREE.BufferGeometry;
      }
    )({}, geometries, attributes, binding, info);
    // Pinned Three ordering: upload current geometry, THEN onBeforeShadow.
    const shadow = objects.update(mesh);
    const args = [null, mesh, null, null, shadow, null, null] as unknown as Parameters<
      typeof mesh.onBeforeShadow
    >;
    mesh.onBeforeShadow(...args);
    expect(resident.has(shadow.getAttribute('position'))).toBe(true);
    expect(shadow.getAttribute('position')).toBe(sourcePosition);
    expect(shadow.index).toBe(geometry.index);
    expect(shadow.drawRange.count).toBe(Infinity);
    mesh.onAfterShadow(...args);
    expect(shadow.drawRange.count).toBe(0);
    objects.update(color);
    expect(resident.has(reducedPosition)).toBe(true);
    session.dispose();
    expect(removed.has(reducedPosition)).toBe(true);
    expect(removed.has(sourcePosition)).toBe(false);
    expect(mesh.geometry).toBe(geometry);
    expect(mesh.children).toHaveLength(0);
  });
});
