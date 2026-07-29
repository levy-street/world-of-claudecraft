import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CHARACTER_SHADOW_ONLY_LAYER,
  CharacterMainPassCullState,
} from '../src/render/character_main_pass_cull';

describe('character main-pass culling', () => {
  it('moves only renderables to the shadow camera layer and restores exact masks', () => {
    const root = new THREE.Group();
    const nested = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());
    mesh.layers.enable(4);
    const originalMeshMask = mesh.layers.mask;
    root.add(nested);
    nested.add(mesh, points);

    const state = new CharacterMainPassCullState();
    state.set(root, true);
    expect(state.isCulled).toBe(true);
    expect(root.layers.mask).toBe(1);
    expect(nested.layers.mask).toBe(1);
    expect(mesh.layers.mask).toBe(1 << CHARACTER_SHADOW_ONLY_LAYER);
    expect(points.layers.mask).toBe(1 << CHARACTER_SHADOW_ONLY_LAYER);

    state.set(root, false);
    expect(state.isCulled).toBe(false);
    expect(mesh.layers.mask).toBe(originalMeshMask);
    expect(points.layers.mask).toBe(1);
  });

  it('discovers newly attached weapon or form nodes while already culled', () => {
    const root = new THREE.Group();
    const first = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    root.add(first);
    const state = new CharacterMainPassCullState();
    state.set(root, true);

    const added = new THREE.Sprite(new THREE.SpriteMaterial());
    root.add(added);
    expect(added.layers.mask).toBe(1);
    state.set(root, true, true);
    expect(added.layers.mask).toBe(1 << CHARACTER_SHADOW_ONLY_LAYER);

    state.restore();
    expect(first.layers.mask).toBe(1);
    expect(added.layers.mask).toBe(1);
  });
});
