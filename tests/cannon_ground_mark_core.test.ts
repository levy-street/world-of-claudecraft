import { describe, expect, it } from 'vitest';
import {
  CANNON_GROUND_MARK,
  cannonCrackTexels,
  cannonGroundMarkFade,
} from '../src/render/cannon_ground_mark_core';
import { cannonScorchTexels } from '../src/render/cannon_shell_core';

describe('cracked ground mark', () => {
  const size = 64;
  const texels = cannonCrackTexels(size);
  const at = (i: number, j: number) => (j * size + i) * 4;
  const amount = (i: number, j: number) => texels[at(i, j)] / 255;

  it('is a faint wash crossed by darker cracks, clear at the rim, grey for its tint to colour', () => {
    expect(texels).toHaveLength(size * size * 4);
    for (let k = 0; k < texels.length; k += 4) {
      expect(texels[k + 3]).toBe(255);
      expect(texels[k + 1]).toBe(texels[k]);
      expect(texels[k + 2]).toBe(texels[k]);
    }
    for (const [i, j] of [
      [0, 0],
      [size - 1, 0],
      [0, size / 2],
      [size / 2, size - 1],
    ]) {
      expect(amount(i, j)).toBe(0);
    }
    // Around the tower's wall (the inner half is under the tower), the ring the
    // camera sees: a light wash, broken by cracks several times as dark.
    const ring: number[] = [];
    for (let k = 0; k < 720; k++) {
      const a = (k / 720) * Math.PI * 2;
      const i = Math.floor(size / 2 + Math.cos(a) * size * 0.3);
      const j = Math.floor(size / 2 + Math.sin(a) * size * 0.3);
      ring.push(amount(i, j));
    }
    const sorted = [...ring].sort((a, b) => a - b);
    const wash = sorted[Math.floor(sorted.length / 2)];
    const crack = sorted[sorted.length - 1];
    expect(wash).toBeGreaterThan(0.1);
    expect(wash).toBeLessThan(0.4);
    expect(crack).toBeGreaterThan(wash * 2);
    // A crack is a line: most of the ring is wash.
    expect(ring.filter((v) => v > (wash + crack) / 2).length).toBeLessThan(ring.length / 3);
    expect(cannonCrackTexels(size)).toEqual(texels);
  });

  it('is lighter than a scorch and takes more blue than red: a pale, dusty stain', () => {
    const char = cannonScorchTexels(size);
    const centre = (size / 2) * size * 4 + (size / 2) * 4;
    const [r, g, b] = CANNON_GROUND_MARK.tint;
    expect(b).toBeGreaterThan(r);
    expect(g).toBeGreaterThanOrEqual(r);
    expect(b).toBeLessThan(0.75);
    // Its darkest crack at full strength darkens less than a scorch's char does.
    let darkest = 0;
    for (let k = 0; k < texels.length; k += 4) darkest = Math.max(darkest, texels[k] / 255);
    expect(darkest * b).toBeLessThan(char[centre + 2] / 255);
  });

  it('shows at once, holds, then fades out over its life', () => {
    const { hold, life } = CANNON_GROUND_MARK;
    expect(cannonGroundMarkFade(-0.1)).toBe(0);
    expect(cannonGroundMarkFade(0)).toBe(0);
    expect(cannonGroundMarkFade(0.1)).toBe(1);
    expect(cannonGroundMarkFade(hold)).toBe(1);
    let last = 1;
    for (let t = hold; t < life; t += 0.1) {
      const f = cannonGroundMarkFade(t);
      expect(f).toBeLessThanOrEqual(last + 1e-12);
      last = f;
    }
    expect(cannonGroundMarkFade(life)).toBe(0);
    expect(cannonGroundMarkFade(Number.NaN)).toBe(0);
  });
});
