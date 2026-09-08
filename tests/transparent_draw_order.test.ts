import * as THREE from 'three';
import { expect, it } from 'vitest';
import {
  markOccluderGhostMaterial,
  markOccluderGhostTwin,
} from '../src/render/occluder_ghost_variant_key';
import { transparentGameplaySort } from '../src/render/transparent_draw_order';

const item = (id: number, material: THREE.Material, groupOrder = 0, renderOrder = 0, z = 0) => ({
  id,
  material,
  groupOrder,
  renderOrder,
  z,
});

it('draws the capture sentinel and combat before depth-writing faded scenery on either side', () => {
  const ghost = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.2, depthWrite: true });
  markOccluderGhostMaterial(ghost);
  const fx = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
  try {
    for (const z of [-10, 10]) {
      const draws = [
        item(3, ghost, -100, 0, z),
        item(2, fx, 0, 6, 0),
        item(1, fx, -Infinity, -Infinity, 0),
      ];
      expect(draws.sort(transparentGameplaySort).map((draw) => draw.id)).toEqual([1, 2, 3]);
    }
    ghost.opacity = 0.92;
    expect(transparentGameplaySort(item(3, ghost), item(2, fx, 0, 6))).toBeGreaterThan(0);
  } finally {
    ghost.dispose();
    fx.dispose();
  }
});

it('retains stable group, explicit order, back-to-front and ID keys for ordinary transparencies', () => {
  const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.2 });
  try {
    const draws = [
      item(5, material, 1),
      item(4, material, 0, 6),
      item(3, material, 0, 0, 2),
      item(2, material, 0, 0, 2),
      item(1, material, 0, 0, 3),
    ];
    expect(draws.sort(transparentGameplaySort).map((draw) => draw.id)).toEqual([1, 2, 3, 4, 5]);
    markOccluderGhostMaterial(material);
    markOccluderGhostTwin(material);
    const normal = new THREE.MeshBasicMaterial({ transparent: true });
    expect(transparentGameplaySort(item(1, material, -1), item(2, normal))).toBeLessThan(0);
    normal.dispose();
  } finally {
    material.dispose();
  }
});
