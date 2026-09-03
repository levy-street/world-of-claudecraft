// @vitest-environment happy-dom

import * as THREE from 'three';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { attachMountGlows, disposeMountGlows, updateMountGlows } from '../src/render/mount_glow';
import { MOUNT_LENS_COLOR, MOUNT_VISUAL_SPECS, mountGlowBreath } from '../src/render/mount_visuals';

function rigWith(...boneNames: string[]): THREE.Object3D {
  const root = new THREE.Object3D();
  for (const name of boneNames) {
    const bone = new THREE.Object3D();
    bone.name = name;
    root.add(bone);
  }
  return root;
}

let contextSpy: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  const gradient = { addColorStop: vi.fn() };
  contextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        createRadialGradient: () => gradient,
        fillRect: vi.fn(),
        fillStyle: '',
      }) as unknown as CanvasRenderingContext2D,
  );
});

afterAll(() => contextSpy.mockRestore());

describe('mount glow billboards', () => {
  it('fails soft when no glow or no authored bone is available', () => {
    expect(attachMountGlows(rigWith('lens'), MOUNT_VISUAL_SPECS.valorsteed)).toBeNull();
    expect(
      attachMountGlows(rigWith('renamed_lens'), MOUNT_VISUAL_SPECS.chimeglass_tortoise),
    ).toBeNull();
  });

  it('attaches, breathes, and disposes both shipped Chimeglass lens halos', () => {
    const rig = rigWith('lens');
    const lens = rig.getObjectByName('lens');
    const spec = MOUNT_VISUAL_SPECS.chimeglass_tortoise;
    const glows = attachMountGlows(rig, spec);
    expect(glows).not.toBeNull();
    if (!glows || !lens) throw new Error('the test rig carries the Chimeglass lens bone');

    expect(spec.glows).toEqual([
      {
        bone: 'lens',
        offset: [-0.0954, 0.0345, -0.0057],
        radius: 0.105,
        color: MOUNT_LENS_COLOR,
        opacity: 0.85,
        pulse: 0.28,
        pulseHz: 0.32,
      },
      {
        bone: 'lens',
        offset: [0.0733, 0.037, -0.0089],
        radius: 0.105,
        color: MOUNT_LENS_COLOR,
        opacity: 0.85,
        pulse: 0.28,
        pulseHz: 0.32,
      },
    ]);
    expect(glows.sprites).toHaveLength(2);
    expect(glows.peaks).toEqual([0.85, 0.85]);
    expect(glows.pulses).toEqual([0.28, 0.28]);
    expect(glows.rates).toEqual([0.32, 0.32]);
    expect(lens.children).toEqual(glows.sprites);
    for (const [index, sprite] of glows.sprites.entries()) {
      const authored = spec.glows[index];
      expect(sprite.position.toArray()).toEqual([...authored.offset]);
      expect(sprite.material.color.getHex()).toBe(MOUNT_LENS_COLOR);
      expect(sprite.material.blending).toBe(THREE.AdditiveBlending);
      expect(sprite.material.depthWrite).toBe(false);
      expect(sprite.material.fog).toBe(false);
      expect(sprite.scale.x).toBeCloseTo(authored.radius * 2, 9);
    }

    updateMountGlows(glows, 0);
    const firstOpacity = glows.sprites.map((sprite) => sprite.material.opacity);
    const firstScale = glows.sprites.map((sprite) => sprite.scale.x);
    updateMountGlows(glows, 1);
    expect(glows.sprites.map((sprite) => sprite.material.opacity)).not.toEqual(firstOpacity);
    expect(glows.sprites.map((sprite) => sprite.scale.x)).not.toEqual(firstScale);

    const disposals = glows.sprites.map((sprite) => vi.spyOn(sprite.material, 'dispose'));
    disposeMountGlows(glows);
    expect(lens.children).toHaveLength(0);
    expect(glows).toEqual({ sprites: [], peaks: [], pulses: [], rates: [], sizes: [] });
    for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
  });

  it('keeps the two lens breaths deterministic, quarter-phased, and inside literal bounds', () => {
    expect(mountGlowBreath(0, 0, 0.28, 0.32)).toBeCloseTo(0.86, 12);
    expect(mountGlowBreath(0, 1, 0.28, 0.32)).toBe(1);
    expect(mountGlowBreath(0.78125, 0, 0.28, 0.32)).toBe(1);
    expect(mountGlowBreath(2.34375, 0, 0.28, 0.32)).toBeCloseTo(0.72, 12);

    const firstPass: number[] = [];
    const secondPass: number[] = [];
    for (let i = 0; i <= 256; i++) {
      const time = i / 64;
      firstPass.push(mountGlowBreath(time, i % 2, 0.28, 0.32));
      secondPass.push(mountGlowBreath(time, i % 2, 0.28, 0.32));
    }
    expect(secondPass).toEqual(firstPass);
    expect(Math.min(...firstPass)).toBeGreaterThanOrEqual(0.72);
    expect(Math.max(...firstPass)).toBeLessThanOrEqual(1);
  });

  it('holds steady for zero breath depth and independently for zero rate', () => {
    expect(mountGlowBreath(137, 0, 0, 0.32)).toBe(1);
    expect(mountGlowBreath(137, 0, 0.28, 0)).toBe(1);
  });
});
