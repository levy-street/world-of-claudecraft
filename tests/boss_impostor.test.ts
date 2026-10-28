import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BossImpostorField } from '../src/render/boss_impostor';
import { NEUTRAL_DAY_GRADE } from '../src/render/day_night_core';

vi.mock('../src/render/characters/assets', () => ({
  prepareVisual: vi.fn(),
  tintedFarMaterials: vi.fn(),
}));
vi.mock('../src/render/characters/manifest', () => ({ visualKeyFor: vi.fn() }));

describe('boss imposter program ownership', () => {
  it('stages a hidden atlas-free shader owner and retains it when every boss leaves', () => {
    const scene = new THREE.Scene();
    const field = new BossImpostorField(scene);
    const root = scene.getObjectByName('bossImpostors');
    expect(root).toBeDefined();
    try {
      expect(root?.children).toHaveLength(1);
      const keeper = root?.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
      expect(keeper.isMesh).toBe(true);
      expect(keeper.visible).toBe(false);
      expect(keeper.material.uniforms.uAtlas.value).toBeNull();
      const materialDisposed = vi.fn();
      const geometryDisposed = vi.fn();
      keeper.material.addEventListener('dispose', materialDisposed);
      keeper.geometry.addEventListener('dispose', geometryDisposed);
      field.sync(
        {} as THREE.WebGLRenderer,
        [],
        new THREE.Camera(),
        { x: 0, z: 0 },
        null,
        () => false,
        NEUTRAL_DAY_GRADE,
        0,
        1,
      );
      expect(root?.children).toEqual([keeper]);
      expect(materialDisposed).not.toHaveBeenCalled();
      expect(geometryDisposed).not.toHaveBeenCalled();
      field.dispose();
      expect(materialDisposed).toHaveBeenCalledOnce();
      expect(geometryDisposed).toHaveBeenCalledOnce();
      expect(scene.children).toEqual([]);
    } finally {
      // Terminal disposal is performed above only after all ownership assertions pass.
      if (root?.parent) field.dispose();
    }
  });
});
