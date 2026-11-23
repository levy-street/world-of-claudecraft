import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildStaticInstanceCells } from '../src/render/static_instance_cells';

const spots = [
  { x: -65, y: 1, z: 0, s: 2, rot: 0.4 },
  { x: -64, y: 2, z: -1, s: 3, rot: 1 },
  { x: -1, y: 3, z: -1, s: 1, rot: 2 },
  { x: 0, y: 4, z: 64, s: 4, rot: 0 },
];

describe('static instance cells', () => {
  it('preserves every exact placement and shared resource across signed cell boundaries', () => {
    const geometry = new THREE.BoxGeometry(8, 2, 4);
    const material = new THREE.MeshBasicMaterial();
    const original = buildStaticInstanceCells(geometry, material, spots, 0);
    const cells = buildStaticInstanceCells(geometry, material, spots, 64);
    expect(cells.map((mesh) => mesh.count)).toEqual([1, 2, 1]);
    const matrices = cells.flatMap((mesh) => {
      expect(mesh.geometry).toBe(geometry);
      expect(mesh.material).toBe(material);
      expect(mesh.frustumCulled && mesh.castShadow && mesh.receiveShadow).toBe(true);
      return Array.from({ length: mesh.count }, (_, i) => {
        const matrix = new THREE.Matrix4();
        mesh.getMatrixAt(i, matrix);
        const box = geometry.boundingBox!.clone().applyMatrix4(matrix);
        expect(mesh.boundingBox!.containsBox(box)).toBe(true);
        const point = new THREE.Vector3();
        for (let j = 0; j < geometry.attributes.position.count; j++) {
          point.fromBufferAttribute(geometry.attributes.position, j).applyMatrix4(matrix);
          expect(point.distanceTo(mesh.boundingSphere!.center)).toBeLessThanOrEqual(
            mesh.boundingSphere!.radius + 1e-6,
          );
        }
        return matrix.elements;
      });
    });
    const originals = spots.map((spot, i) => {
      const matrix = new THREE.Matrix4();
      original[0].getMatrixAt(i, matrix);
      // Independent authored transform: uniform scale, Y rotation, translation.
      // Comparing the split and control alone would miss a mistake shared by both.
      const c = Math.cos(spot.rot) * spot.s;
      const s = Math.sin(spot.rot) * spot.s;
      const expected = [c, 0, -s, 0, 0, spot.s, 0, 0, s, 0, c, 0, spot.x, spot.y, spot.z, 1];
      matrix.elements.forEach((value, j) => {
        expect(value).toBeCloseTo(expected[j], 5);
      });
      return matrix.elements;
    });
    expect(matrices).toEqual(originals);
  });

  it('culls an offscreen cell without rejecting a visible instance across its grid edge', () => {
    const geometry = new THREE.BoxGeometry(20, 20, 20);
    const placements = [
      { x: 65, y: 0, z: -20, s: 1, rot: 0 },
      { x: -500, y: 0, z: -20, s: 1, rot: 0 },
    ];
    const cells = buildStaticInstanceCells(geometry, new THREE.MeshBasicMaterial(), placements, 64);
    const camera = new THREE.OrthographicCamera(50, 60, 10, -10, 1, 100);
    camera.updateMatrixWorld(true);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    // Centre is outside the view, but the geometry extends into it.
    expect(frustum.containsPoint(new THREE.Vector3(65, 0, -20))).toBe(false);
    expect(frustum.intersectsObject(cells[0])).toBe(true);
    expect(frustum.intersectsObject(cells[1])).toBe(false);
  });

  it('handles empty input and disabled or non-finite sizes without dropping placements', () => {
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial();
    expect(buildStaticInstanceCells(geometry, material, [], 64)).toEqual([]);
    for (const size of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const meshes = buildStaticInstanceCells(geometry, material, spots, size);
      expect(meshes).toHaveLength(1);
      expect(meshes[0].count).toBe(spots.length);
    }
  });
});
