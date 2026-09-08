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
  const decalXZ = vi.fn();
  const admitted: boolean[] = [];
  const host = {
    groundYAt: () => 0,
    crestAt: () => false,
    decalXZ,
    pathRibbon: (color: number, width: number, life: number, draw: typeof fill) => {
      const result = ribbons.spawnPath(color, width, life, draw);
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
  ribbons.dispose();
  texture.dispose();
});
