import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  disposeMaterialVariants,
  restoreOriginalMaterials,
} from '../src/render/characters/material_state';

describe('character material state', () => {
  it('restores live meshes before a graph rebuild snapshots effect overlays', () => {
    const root = new THREE.Group();
    const base = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const overlay = base.clone();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), overlay);
    root.add(mesh);

    restoreOriginalMaterials(new Map([[mesh, base]]));

    expect(mesh.material).toBe(base);
  });

  it('disposes every unique variant and clears every supplied cache', () => {
    const source = new THREE.MeshBasicMaterial();
    const shared = new THREE.MeshBasicMaterial();
    const extra = new THREE.MeshBasicMaterial();
    const sharedDispose = vi.spyOn(shared, 'dispose');
    const extraDispose = vi.spyOn(extra, 'dispose');
    const first = new Map([[source, shared]]);
    const second = new Map([
      [source, shared],
      [shared, extra],
    ]);

    disposeMaterialVariants([first, second]);

    expect(sharedDispose).toHaveBeenCalledTimes(1);
    expect(extraDispose).toHaveBeenCalledTimes(1);
    expect(first.size).toBe(0);
    expect(second.size).toBe(0);
  });
});
