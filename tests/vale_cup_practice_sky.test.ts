import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The practice sky's sphere is VISIBLE for the whole bout, and its panorama
// arrives lazily. A null-to-texture write on the map slot is a program-cache-key
// change (map presence), so the decode used to link a new program inside a live
// frame; a populated slot makes the arrival a plain texture swap.
const panorama = new THREE.Texture();
const loadTexture = vi.fn(async () => panorama);

describe('ValeCupPracticeSky', () => {
  beforeEach(() => {
    vi.resetModules();
    loadTexture.mockClear();
    vi.doMock('../src/render/assets/loader', () => ({ loadTexture }));
  });

  it('keeps the map slot populated across the panorama arrival', async () => {
    const { ValeCupPracticeSky } = await import('../src/render/vale_cup_practice_sky');
    const { materialProgramSignature } = await import('../src/render/prewarm_policy');
    const sky = new ValeCupPracticeSky();
    const material = sky.mesh.material as THREE.MeshBasicMaterial;

    const standIn = material.map;
    expect(standIn).not.toBeNull();
    const before = materialProgramSignature(material);

    sky.setVariant(2);
    expect(loadTexture).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(material.map).toBe(panorama);
    expect(materialProgramSignature(material)).toBe(before);
    // The stand-in is one texel, and it is released once it is off the slot.
    expect((standIn?.image as { width: number } | undefined)?.width).toBe(1);
  });

  it('still orients and grades each variant, and loads the panorama once', async () => {
    const { ValeCupPracticeSky } = await import('../src/render/vale_cup_practice_sky');
    const sky = new ValeCupPracticeSky();
    const material = sky.mesh.material as THREE.MeshBasicMaterial;

    sky.setVariant(1);
    const rotation = sky.mesh.rotation.y;
    const tint = material.color.getHex();
    sky.setVariant(3);

    expect(sky.mesh.rotation.y).not.toBe(rotation);
    expect(material.color.getHex()).not.toBe(tint);
    expect(loadTexture).toHaveBeenCalledTimes(1);
  });
});
