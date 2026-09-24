import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { GroundDecals } from '../src/render/ability_vfx/decals';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';

function fixture() {
  const scene = new THREE.Scene();
  const texture = new THREE.CanvasTexture({ width: 2, height: 2 } as HTMLCanvasElement);
  const textures = Object.fromEntries(
    ['ember', 'rime', 'rune', 'crack', 'char', 'leapFracture', 'shamanFracture', 'noise'].map(
      (key) => [key, texture],
    ),
  ) as unknown as AbilityVfxTextures;
  const ground = vi.fn((x: number, z: number) => x * 0.1 + z * 0.03);
  const decals = new GroundDecals(scene, textures, ground);
  const meshes = scene.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
  const reveal = (mesh = meshes[0]) => {
    (mesh.onBeforeRender as () => void)();
    return (mesh.material as THREE.ShaderMaterial).uniforms.uReveal.value as number;
  };
  return { decals, meshes, reveal, ground, texture };
}

describe('Shaman optional ground fracture reveal', () => {
  it('reveals existing ink progressively without rescaling, resampling terrain or extending expiry', () => {
    const h = fixture();
    h.decals.spawn(12, 1.35, 5, 8, 0x7d8984, 'shaman_fracture', 6, 0.65);
    const mesh = h.meshes[0];
    const drape = mesh.geometry.getAttribute('aDrape') as THREE.BufferAttribute;
    const drapeVersion = drape.version;
    const positions = Array.from(drape.array);
    const samples = h.ground.mock.calls.length;
    const bounds = mesh.geometry.boundingSphere?.clone();
    expect(h.reveal()).toBe(0);
    expect(samples).toBeGreaterThan(0);
    h.decals.update(0.325);
    expect(h.reveal()).toBeCloseTo(0.5);
    h.decals.update(0.325);
    expect(h.reveal()).toBe(1);
    h.decals.update(5.34);
    expect(mesh.visible).toBe(true);
    expect(h.reveal()).toBe(1);
    expect(mesh.scale.toArray()).toEqual([8, 8, 8]);
    expect(mesh.geometry.boundingSphere).toEqual(bounds);
    expect(Array.from(drape.array)).toEqual(positions);
    expect(drape.version).toBe(drapeVersion);
    expect(h.ground).toHaveBeenCalledTimes(samples);
    h.decals.update(0.011);
    expect(mesh.visible).toBe(false);
    h.decals.dispose();
    h.texture.dispose();
  });

  it('keeps the shared material but resets reveal independently on every slot reuse', () => {
    const h = fixture();
    h.decals.spawn(0, 0, 0, 8, 0xffffff, 'shaman_fracture', 6, 0.65);
    const material = h.meshes[0].material;
    h.decals.spawn(0, 0, 0, 8, 0xffffff, 'shaman_fracture', 6);
    expect(h.meshes).toHaveLength(12);
    expect(h.meshes[1].material).toBe(material);
    expect(h.reveal(h.meshes[0])).toBe(0);
    expect(h.reveal(h.meshes[1])).toBe(1);
    expect(h.reveal(h.meshes[0])).toBe(0);
    for (let i = 2; i <= 12; i++) h.decals.spawn(0, 0, 0, 8, 0xffffff, 'shaman_fracture', 6);
    expect(h.meshes[0].material).toBe(material);
    expect(h.reveal()).toBe(1);
    h.decals.update(0.2);
    expect(h.reveal()).toBe(1);
    h.decals.clear();
    expect(h.meshes.every((mesh) => !mesh.visible)).toBe(true);
    h.decals.dispose();
    h.texture.dispose();
  });

  it.each([0, -1, NaN, Infinity])(
    'default or invalid reveal %s keeps a static full fracture',
    (duration) => {
      const h = fixture();
      h.decals.spawn(0, 0, 0, 8, 0xffffff, 'shaman_fracture', 6, duration);
      expect(h.reveal()).toBe(1);
      h.decals.update(0.1);
      expect(h.reveal()).toBe(1);
      h.decals.dispose();
      h.texture.dispose();
    },
  );

  it('does not opt Warrior fracture or other materials into the Shaman reveal', () => {
    const h = fixture();
    h.decals.spawn(0, 0, 0, 8, 0xffffff, 'leap_fracture', 6, 0.65);
    h.decals.spawn(0, 0, 0, 8, 0xffffff, 'rune', 6, 0.65);
    expect(h.reveal(h.meshes[0])).toBe(1);
    expect(h.reveal(h.meshes[1])).toBe(1);
    h.decals.update(0.2);
    expect(h.reveal(h.meshes[0])).toBe(1);
    expect(h.reveal(h.meshes[1])).toBe(1);
    h.decals.dispose();
    h.texture.dispose();
  });
});
