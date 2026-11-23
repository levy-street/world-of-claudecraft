import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { chainBridgeCrustGeometry } from '../src/render/gravewyrm_sanctum/sanctum_bridge_geometry';
import { chainBridgeDeckHeight } from '../src/render/gravewyrm_sanctum/sanctum_gates_core';

describe('chain bridge ice deck', () => {
  it('faces the camera above the bridge and covers the walk at the sim height', () => {
    const geometry = chainBridgeCrustGeometry();
    expect(geometry.getAttribute('uv').count).toBe(geometry.getAttribute('position').count);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    const ray = new THREE.Raycaster();
    for (const z of [1, 7, 14, 21, 27]) {
      for (const x of [-2.5, 0, 2.5]) {
        ray.set(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
        const hit = ray.intersectObject(mesh)[0];
        expect(hit, `ice visible from above at ${x}, ${z}`).toBeDefined();
        expect(hit.point.y).toBeCloseTo(chainBridgeDeckHeight(z) + 0.04, 4);
        expect(hit.face?.normal.y).toBeGreaterThan(0.9);
      }
    }
    geometry.dispose();
    mesh.material.dispose();
  });
});
