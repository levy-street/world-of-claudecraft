import { createHash } from 'node:crypto';
import type { BufferGeometry } from 'three';
import { expect, it } from 'vitest';
import { warriorLeapShape } from '../src/render/ability_vfx/warrior_leap_shape';

/** Recover each solid from triangle connectivity and coincident positions,
 * without trusting generation order, slab counts per cluster or phase values. */
function pieces(geometry: BufferGeometry): number[][] {
  const position = geometry.getAttribute('position');
  expect(geometry.getIndex()).toBeNull();
  const parents = Array.from({ length: position.count }, (_, i) => i);
  function root(i: number): number {
    while (parents[i] !== i) i = parents[i];
    return i;
  }
  function join(a: number, b: number): void {
    parents[root(a)] = root(b);
  }
  const coincident = new Map<string, number>();
  for (let i = 0; i < position.count; i++) {
    const key = `${position.getX(i)},${position.getY(i)},${position.getZ(i)}`;
    const previous = coincident.get(key);
    if (previous === undefined) coincident.set(key, i);
    else join(previous, i);
  }
  for (let i = 0; i < position.count; i += 3) {
    join(i, i + 1);
    join(i, i + 2);
  }
  const connected = new Map<number, number[]>();
  for (let i = 0; i < position.count; i++) {
    const owner = root(i);
    let piece = connected.get(owner);
    if (!piece) {
      piece = [];
      connected.set(owner, piece);
    }
    piece.push(i);
  }
  return [...connected.values()];
}
function hash(values: Float32Array): string {
  return createHash('sha256')
    .update(Buffer.from(values.buffer, values.byteOffset, values.byteLength))
    .digest('hex');
}

it('preserves every authored landing vertex and bevel mask while adding no geometry or attributes', () => {
  const geometry = warriorLeapShape();
  try {
    expect(Object.keys(geometry.attributes).sort()).toEqual(['normal', 'position', 'uv']);
    const position = geometry.getAttribute('position'),
      uv = geometry.getAttribute('uv');
    expect(position.count).toBe(1620);
    expect(position.count / 3).toBe(540);
    // Before-change fingerprints pin only unchanged positions and UV.y masks;
    // UV.x is deliberately checked by the independent spatial test below.
    expect(hash(Float32Array.from(position.array))).toBe(
      'c14a515b610ad1eadd9eb94ae524c873267056945c4e5d40c67d9336a7789715',
    );
    expect(hash(Float32Array.from({ length: uv.count }, (_, i) => uv.getY(i)))).toBe(
      '3bda0e6e7db6312c6f57145ffb95c44303870ce1eaa2d77fcd833c2211bed422',
    );
    for (const attribute of Object.values(geometry.attributes))
      expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
    for (let i = 0; i < position.count; i++) {
      const radius = Math.hypot(position.getX(i), position.getZ(i));
      expect(radius).toBeGreaterThan(1.35);
      expect(radius).toBeLessThanOrEqual(6);
      expect(position.getY(i)).toBeGreaterThan(0);
    }
  } finally {
    geometry.dispose();
  }
});

it('gives each complete slab one coherent distance phase with inner slabs preceding outer slabs', () => {
  const geometry = warriorLeapShape();
  try {
    const slabs = pieces(geometry);
    expect(slabs).toHaveLength(20);
    const position = geometry.getAttribute('position'),
      uv = geometry.getAttribute('uv');
    const bands: number[][] = [[], [], []];
    for (const slab of slabs) {
      const radius = Math.min(...slab.map((i) => Math.hypot(position.getX(i), position.getZ(i))));
      const phase = uv.getX(slab[0]);
      expect(Number.isFinite(phase)).toBe(true);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThanOrEqual(1);
      for (const vertex of slab) expect(uv.getX(vertex)).toBe(phase);
      expect(phase).toBeCloseTo(radius / 6, 6);
      bands[radius < 2 ? 0 : radius < 4 ? 1 : 2].push(phase);
      const masks = [...new Set(slab.map((i) => uv.getY(i)))].sort((a, b) => a - b);
      expect(masks).toHaveLength(3);
      expect(masks[0]).toBeCloseTo(0.01, 6);
      expect(masks[1]).toBeCloseTo(0.07, 6);
      expect(masks[2]).toBeCloseTo(0.65, 6);
    }
    expect(bands.map((band) => band.length)).toEqual([5, 5, 10]);
    expect(Math.max(...bands[0])).toBeLessThan(Math.min(...bands[1]));
    expect(Math.max(...bands[1])).toBeLessThan(Math.min(...bands[2]));
  } finally {
    geometry.dispose();
  }
});
