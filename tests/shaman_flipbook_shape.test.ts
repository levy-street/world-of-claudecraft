import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ImpactFlipbooks } from '../src/render/ability_vfx/flipbooks';
import {
  boundQuadSize,
  IMPACT_QUAD_MAX_SCREEN_FRACTION,
} from '../src/render/vfx_screen_bounds_core';

vi.mock('../src/render/ability_vfx/fx_textures', async () => {
  const { Texture } = await import('three');
  const texture = new Texture();
  return {
    abilityVfxTextures: () => ({ noise: texture }),
    FLIPBOOK_GRID: 8,
    FLIPBOOK_STYLES: [],
    flipbookSheet: () => texture,
  };
});
vi.mock('../src/render/ability_vfx/contact_assets', async () => {
  const { Texture } = await import('three');
  const texture = new Texture();
  return { contactTexture: () => texture, isContactSheet: () => false };
});

function rig() {
  const scene = new THREE.Scene();
  const sheets = new ImpactFlipbooks(scene);
  const meshes = scene.children as THREE.Mesh[];
  return { sheets, meshes };
}
describe('Shaman authored flipbook proportions', () => {
  it.each([0.72, 1.55])(
    'honours aspect %s without reducing either previous square axis',
    (aspect) => {
      const { sheets, meshes } = rig();
      sheets.spawn(0, 1, 0, 4, 0xffffff, 1, 'shaman_dust', 0.4, 0, aspect);
      sheets.update(0.1, new THREE.Quaternion());
      const scale = meshes[0].scale;
      expect(scale.x / scale.y).toBeCloseTo(aspect);
      expect(Math.min(scale.x, scale.y)).toBeCloseTo(4 * 1.2);
      const atContact = scale.clone();
      sheets.update(0.15, new THREE.Quaternion());
      expect(meshes[0].scale).toEqual(atContact);
      sheets.dispose();
    },
  );
  it('bounds the longest stretched axis at a close camera', () => {
    const { sheets, meshes } = rig();
    for (const aspect of [0.3, 3.5])
      sheets.spawn(0, 0, 0, 40, 0xffffff, 1, 'shaman_dust', 0.4, 0, aspect);
    const camera = new THREE.Vector3(0, 0, 2);
    sheets.update(0.1, new THREE.Quaternion(), camera, 0.5);
    const maximum = boundQuadSize(1000, 2, 0.5, IMPACT_QUAD_MAX_SCREEN_FRACTION);
    for (const mesh of meshes.slice(0, 2))
      expect(Math.max(mesh.scale.x, mesh.scale.y)).toBeCloseTo(maximum);
    sheets.dispose();
  });
  it('preserves generic non-Shaman scale and clears the shape flag when a pool slot is reused', () => {
    const { sheets, meshes } = rig();
    sheets.spawn(0, 0, 0, 4, 0xffffff, 1, 'shaman_dust', 0.4, 0, 3);
    expect((meshes[0].material as THREE.ShaderMaterial).uniforms.uAuthoredColor.value).toBe(1);
    for (let i = 0; i < 6; i++) sheets.spawn(0, 0, 0, 4, 0xffffff, 1, 'electric', 0.4, 0, 3);
    sheets.update(0.1, new THREE.Quaternion());
    expect(meshes).toHaveLength(6);
    expect(meshes.every((m) => m.scale.x === m.scale.y)).toBe(true);
    expect(
      meshes.every((m) => (m.material as THREE.ShaderMaterial).uniforms.uAuthoredColor.value === 0),
    ).toBe(true);
    expect(
      meshes.every((m) => (m.material as THREE.ShaderMaterial).uniforms.uShamanStyle.value === 0),
    ).toBe(true);
    sheets.dispose();
  });
  it('routes distinct earth art through the same six prepared slots and resets it on Warrior reuse', () => {
    const { sheets, meshes } = rig();
    const styles = [
      'shaman_dust',
      'shaman_earth_cleave',
      'shaman_earth_ram',
      'shaman_earth_fault',
    ] as const;
    for (const style of styles) sheets.spawn(1, 2, 3, 4, 0xffffff, 1, style);
    for (let i = 0; i < 4; i++) {
      const uniforms = (meshes[i].material as THREE.ShaderMaterial).uniforms;
      expect(uniforms.uShamanStyle.value).toBe(2);
      expect(uniforms.uShamanVariant.value).toBe(i + 1);
      expect(meshes[i].position.toArray()).toEqual([1, 2, 3]);
    }
    for (let i = 0; i < 6; i++) sheets.spawn(0, 0, 0, 4, 0xffffff, 1, 'warrior_steel_flash');
    expect(meshes).toHaveLength(6);
    for (const mesh of meshes) {
      const uniforms = (mesh.material as THREE.ShaderMaterial).uniforms;
      expect(uniforms.uShamanStyle.value).toBe(0);
      expect(uniforms.uWarriorStyle.value).toBe(1);
    }
    sheets.update(1, new THREE.Quaternion());
    expect(meshes.every((m) => !m.visible)).toBe(true);
    sheets.dispose();
  });
});
