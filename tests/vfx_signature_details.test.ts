import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/render/ability_vfx/signature_texture', async () => {
  const { Texture } = await import('three');
  const atlas = new Texture();
  return { signatureTexture: () => atlas };
});

import { collectAbilityVfxCompileTargets } from '../src/render/ability_vfx/prewarm';
import { SignatureCrests } from '../src/render/ability_vfx/signature_crests';
import { SignatureDetails } from '../src/render/ability_vfx/signature_details';

describe('signature detail pools', () => {
  it('prepares both programs while invisible and allocates no new objects on casts', () => {
    const scene = new THREE.Scene(),
      details = new SignatureDetails(scene),
      crests = new SignatureCrests(scene);
    expect(collectAbilityVfxCompileTargets(scene)).toHaveLength(2);
    expect(scene.children.every((c) => !c.visible)).toBe(true);
    const count = scene.children.length;
    for (let i = 0; i < 100; i++) {
      details.spawn(i, 1, 2, 3, 0x555555, 0xffffff, 'fire');
      crests.spawn(i, 0, 2, 2, 1, 0x555555, 0xffffff, 'ice');
    }
    details.update(0.2, new THREE.Quaternion(), false);
    crests.update(0.2, false);
    expect(scene.children).toHaveLength(count);
    expect(scene.children.filter((c) => c.visible)).toHaveLength(20);
    details.update(10, new THREE.Quaternion(), false);
    crests.update(10, false);
    expect(scene.children.every((c) => !c.visible)).toBe(true);
    details.dispose();
    crests.dispose();
    expect(scene.children).toHaveLength(0);
  });
  it('honors delays and reduced motion while retaining expiry', () => {
    const scene = new THREE.Scene(),
      details = new SignatureDetails(scene),
      q = new THREE.Quaternion();
    details.spawn(0, 1, 0, 3, 0x777777, 0xffffff, 'shadow', 0.3, 1);
    details.update(0.2, q, true);
    expect(scene.children.every((c) => !c.visible)).toBe(true);
    details.update(0.2, q, true);
    const mesh = scene.children.find((c) => c.visible) as THREE.Mesh;
    expect(mesh.position.y).toBe(1);
    const scale = mesh.scale.x;
    details.update(0.2, q, true);
    expect(mesh.position.y).toBe(1);
    expect(mesh.scale.x).toBe(scale);
    details.clear();
    details.update(0.2, q, false);
    expect(scene.children.every((c) => !c.visible)).toBe(true);
    details.dispose();
  });
  it('drapes dark residue once, keeps it fixed and resets reused slots', () => {
    const scene = new THREE.Scene(),
      details = new SignatureDetails(scene),
      q = new THREE.Quaternion();
    const ground = vi.fn((x: number, z: number) => x * 0.2 + z * 0.1);
    details.residue(4, 5, 1, 0x251e1a, 'fire', ground);
    const samples = ground.mock.calls.length;
    details.update(0.3, q, false);
    const mesh = scene.children.find((c) => c.visible) as THREE.Mesh;
    const positions = mesh.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++)
      expect(positions.getY(i) + mesh.position.y).toBeCloseTo(
        (positions.getX(i) + 4) * 0.2 + (positions.getZ(i) + 5) * 0.1 + 0.075,
      );
    details.update(0.3, q, false);
    expect(ground).toHaveBeenCalledTimes(samples);
    details.clear();
    details.spawn(0, 1, 0, 2, 0x777777, 0xffffff, 'water');
    details.update(0.1, q, false);
    expect(mesh.geometry.getAttribute('position').getZ(0)).toBe(0);
    expect(mesh.renderOrder).toBe(6);
    details.dispose();
  });
  it('rejects nonfinite spawns and survives repeat teardown', () => {
    const scene = new THREE.Scene(),
      details = new SignatureDetails(scene),
      crests = new SignatureCrests(scene);
    details.spawn(NaN, 0, 0, 1, 0, 0, 'fire');
    crests.spawn(0, 0, 0, Infinity, 1, 0, 0, 'ice');
    details.update(NaN, new THREE.Quaternion(), false);
    crests.update(NaN, false);
    expect(scene.children.every((c) => !c.visible)).toBe(true);
    details.dispose();
    details.dispose();
    crests.dispose();
    crests.dispose();
    details.spawn(0, 0, 0, 1, 0, 0, 'fire');
    expect(scene.children).toHaveLength(0);
  });
});
