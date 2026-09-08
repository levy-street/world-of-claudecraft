import * as THREE from 'three';
import { expect, it } from 'vitest';
import type { AbilityVfxTextures } from '../src/render/ability_vfx/fx_textures';
import { AbilityVfxRibbons } from '../src/render/ability_vfx/ribbons';

function fixture() {
  const texture = new THREE.Texture();
  const ribbons = new AbilityVfxRibbons(new THREE.Scene(), () => null, {
    ribbon: texture,
    noise: texture,
  } as AbilityVfxTextures);
  const camera = new THREE.Vector3(0, 4, 20);
  const fill = (points: THREE.Vector3[]) => {
    points.forEach((p, i) => {
      p.set(-8 + (16 * i) / (points.length - 1), 0.5, 0);
    });
    return points.length;
  };
  const spawn = (swept: boolean) =>
    ribbons.spawnPath(
      0xffffff,
      0.2,
      0.3,
      fill,
      true,
      null,
      false,
      false,
      1,
      swept ? { from: 0, to: 1 } : null,
    );
  const frame = (dt: number, reduced = false) => {
    ribbons.update(dt, camera, reduced);
    const geo = (ribbons as unknown as { geo: THREE.BufferGeometry }).geo;
    const index = geo.getIndex()!;
    const indices = Array.from(index.array).slice(0, geo.drawRange.count);
    const vertices = indices.length ? Math.max(...indices) + 1 : 0;
    return {
      indices,
      vertices,
      positions: Array.from(geo.getAttribute('position').array).slice(0, vertices * 3),
      colors: Array.from(geo.getAttribute('aCol').array).slice(0, vertices * 3),
    };
  };
  return {
    ribbons,
    spawn,
    frame,
    dispose: () => {
      ribbons.dispose();
      texture.dispose();
    },
  };
}

it('advances the bright edge through the real packed ribbon without shrinking its footprint', () => {
  const h = fixture();
  try {
    h.spawn(true);
    const first = h.frame(0.05),
      later = h.frame(0.1);
    const peakX = (frame: typeof first) => {
      let peak = 0;
      for (let i = 3; i < frame.colors.length; i += 3)
        if (frame.colors[i] > frame.colors[peak]) peak = i;
      return frame.positions[peak];
    };
    expect(peakX(first)).toBeLessThan(-2);
    expect(peakX(later)).toBeGreaterThan(3);
    expect(later.positions).toEqual(first.positions);
    expect(first.vertices).toBe(136);
    expect(first.indices).toHaveLength(396);
    expect(first.colors.every(Number.isFinite)).toBe(true);
    expect(later.colors.every(Number.isFinite)).toBe(true);
    expect(first.colors.every((c) => c > 0)).toBe(true);
    expect(Math.min(...first.positions.filter((_, i) => i % 3 === 0))).toBe(-8);
    expect(Math.max(...first.positions.filter((_, i) => i % 3 === 0))).toBe(8);
  } finally {
    h.dispose();
  }
});

it('renders the complete ordinary path under reduced motion', () => {
  const swept = fixture(),
    ordinary = fixture();
  try {
    swept.spawn(true);
    ordinary.spawn(false);
    expect(swept.frame(0.05, true)).toEqual(ordinary.frame(0.05, true));
    expect(swept.frame(0.1, true)).toEqual(ordinary.frame(0.1, true));
  } finally {
    swept.dispose();
    ordinary.dispose();
  }
});

it('does not leave directional shading behind when a timed slot is reused', () => {
  const reused = fixture(),
    clean = fixture();
  try {
    reused.spawn(true);
    expect(reused.frame(0.31).indices).toHaveLength(0);
    reused.spawn(false);
    clean.spawn(false);
    expect(reused.frame(0.05)).toEqual(clean.frame(0.05));
    reused.ribbons.clear();
    reused.spawn(false);
    clean.ribbons.clear();
    clean.spawn(false);
    expect(reused.frame(0.1)).toEqual(clean.frame(0.1));
  } finally {
    reused.dispose();
    clean.dispose();
  }
});
