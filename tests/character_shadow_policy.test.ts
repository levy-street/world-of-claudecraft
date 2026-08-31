import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { characterMeshCastsShadow } from '../src/render/characters/shadow_policy';

describe('character shadow policy', () => {
  it('keeps ordinary character geometry in the shadow-caster set', () => {
    const mesh = new THREE.Mesh();
    mesh.name = 'body';

    expect(characterMeshCastsShadow(mesh)).toBe(true);
  });

  it('honors authored shadow-caster exclusions preserved in GLTF extras', () => {
    const emissiveMesh = new THREE.Mesh();
    emissiveMesh.name = 'IgnivarAnimatedFurnaceCore';
    emissiveMesh.userData.shadowCaster = false;

    expect(characterMeshCastsShadow(emissiveMesh)).toBe(false);
  });

  it('keeps the additive class halo out of the caster set', () => {
    const halo = new THREE.Mesh();
    halo.name = 'class_halo';

    expect(characterMeshCastsShadow(halo)).toBe(false);
  });
});
