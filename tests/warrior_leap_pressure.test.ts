import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';
import type { SequencerHost } from '../src/render/ability_vfx/sequencer';
import { drawWarriorLeapLanding } from '../src/render/ability_vfx/warrior_leap';

it('retains a complete landing primary when all shared attack paths are occupied', () => {
  const scene = new THREE.Scene();
  const texture = new THREE.CanvasTexture({} as HTMLCanvasElement);
  const textures = new Proxy({}, { get: () => texture }) as AbilityVfxTextures;
  const ribbons = new AbilityVfxRibbons(scene, () => null, textures);
  const fill = (points: THREE.Vector3[]) => {
    points.forEach((p, i) => {
      p.set(i, 0, 0);
    });
    return points.length;
  };
  for (let i = 0; i < 20; i++)
    expect(ribbons.spawnPath(0xffffff, 0.2, 1, fill, true, null, false, false, 1)).toBe(true);
  const camera = new THREE.Vector3(0, 5, 12);
  const packed = () => {
    const geo = (ribbons as unknown as { geo: THREE.BufferGeometry }).geo;
    const index = geo.getIndex();
    if (!index) throw new Error('Missing ribbon indices');
    const used = Math.max(...Array.from(index.array).slice(0, geo.drawRange.count)) + 1;
    return Array.from(geo.getAttribute('position').array).slice(0, used * 3);
  };
  ribbons.update(0.02, camera, false);
  const before = packed();
  const decalXZ = vi.fn();
  const flipbookAt = vi.fn(),
    shakeAt = vi.fn(),
    bakedAt = vi.fn(),
    contact = vi.fn();
  const admitted: boolean[] = [];
  const host = {
    groundYAt: () => 0,
    crestAt: () => false,
    decalXZ,
    flipbookAt,
    shakeAt,
    bakedAt,
    contact,
    pathRibbon: (
      ...[color, width, life, draw, brushed, motion, preserve, priority, sweep, follow]: Parameters<
        SequencerHost['pathRibbon']
      >
    ) => {
      const result = ribbons.spawnPath(
        color,
        width,
        life,
        draw,
        brushed,
        motion,
        preserve,
        follow,
        priority,
        sweep,
      );
      admitted.push(result);
      return result;
    },
  } as unknown as SequencerHost;
  drawWarriorLeapLanding(host, 0, 0, 6, 2);
  // Either eight complete branches, or the entire authored fracture drawing
  // in one ground owner. Partial branches cannot satisfy this requirement.
  expect(
    admitted.filter(Boolean).length === 8 ||
      decalXZ.mock.calls.some((call) => call[2] === 6 && call[4] === 'leap_fracture'),
  ).toBe(true);
  expect(admitted).toEqual(Array.from({ length: 8 }, () => false));
  expect(decalXZ).toHaveBeenCalledExactlyOnceWith(0, 0, 6, 0xffffff, 'leap_fracture', 0.72);
  expect(flipbookAt).toHaveBeenCalledExactlyOnceWith(
    0,
    0.12,
    0,
    9,
    0xc1d8e7,
    'warrior_crush_flash',
    4.5,
    0.3,
    0,
    1.8,
  );
  expect(shakeAt).toHaveBeenCalledExactlyOnceWith(0, 0, 0, 0.24, true);
  expect(contact).not.toHaveBeenCalled();
  expect(bakedAt.mock.calls.every((call) => call[0] === 'shout_dust' && call[8] === 0)).toBe(true);
  // A saturated landing cannot evict any of the existing primary attack paths.
  ribbons.update(0, camera, false);
  expect(packed()).toEqual(before);
  ribbons.dispose();
  texture.dispose();
});
