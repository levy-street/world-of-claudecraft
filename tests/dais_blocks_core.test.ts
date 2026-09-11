import { describe, expect, it } from 'vitest';
import {
  DAIS_BLOCK_KIND,
  type DaisBlockSink,
  daisBlockHalfExtent,
  hash2,
  stackDaisBlocks,
} from '../src/render/dais_blocks_core';
import { DAIS_PLATFORM_HEIGHT } from '../src/render/dais_lift';
import {
  DAIS_HEIGHT,
  NYTHRAXIS_LAYOUT,
  NYTHRAXIS_PLATFORM_RADIUS,
} from '../src/sim/dungeon_layout';

// The foundation-block disc under a raised dais or a Nythraxis flanking
// platform (v0.42.2), extracted from the dungeon builder so the block layout
// is a pure, pinnable function of the disc. The sim's floor lift and the
// render lift must agree on the height (DAIS_HEIGHT vs DAIS_PLATFORM_HEIGHT).

interface Placed {
  kind: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: [number, number, number];
}

function record(d: { x: number; z: number; r: number }): Placed[] {
  const out: Placed[] = [];
  const sink: DaisBlockSink = {
    add: (kind, x, y, z, rot, scale) => {
      out.push({ kind, x, y, z, rot, scale });
    },
  };
  stackDaisBlocks(sink, d);
  return out;
}

describe('dais foundation blocks', () => {
  it('fills the platform disc with 2u blocks on the 4u grid, none past the rim', () => {
    const d = { x: -30, z: 96, r: NYTHRAXIS_PLATFORM_RADIUS };
    const blocks = record(d);
    // Every grid point within the radius, and only those: 21 for r = 9.5.
    let expected = 0;
    for (let x = -16; x <= 16; x += 4) {
      for (let z = -16; z <= 16; z += 4) if (Math.hypot(x, z) <= d.r) expected++;
    }
    expect(blocks).toHaveLength(expected);
    expect(blocks).toHaveLength(21);
    const quarter = Math.PI / 2;
    for (const b of blocks) {
      expect(b.kind).toBe(DAIS_BLOCK_KIND);
      expect(b.kind).toBe('floor_foundation_allsides');
      expect(b.y).toBe(0);
      expect(Math.hypot(b.x - d.x, b.z - d.z)).toBeLessThanOrEqual(d.r);
      expect(b.scale).toEqual([1.85, DAIS_PLATFORM_HEIGHT / 2, 1.85]);
      expect([0, quarter, 2 * quarter, 3 * quarter]).toContain(b.rot);
    }
  });

  it('is the same disc the sim lifts its floor by, wherever it is placed', () => {
    expect(DAIS_PLATFORM_HEIGHT).toBe(DAIS_HEIGHT);
    expect(DAIS_HEIGHT).toBe(0.6);
    const origin = record({ x: 0, z: 0, r: NYTHRAXIS_PLATFORM_RADIUS });
    expect(NYTHRAXIS_LAYOUT.platforms).toHaveLength(2);
    for (const platform of NYTHRAXIS_LAYOUT.platforms ?? []) {
      const moved = record(platform);
      expect(moved.map((b) => [b.x - platform.x, b.z - platform.z, b.rot])).toEqual(
        origin.map((b) => [b.x, b.z, b.rot]),
      );
    }
    // Deterministic: a rebuild stacks the identical disc.
    expect(record({ x: 0, z: 0, r: NYTHRAXIS_PLATFORM_RADIUS })).toEqual(origin);
  });

  it('covers a wider disc in full instead of clipping it to the old 16 yd square', () => {
    expect(daisBlockHalfExtent(NYTHRAXIS_PLATFORM_RADIUS)).toBe(12);
    expect(daisBlockHalfExtent(20)).toBe(20);
    const wide = record({ x: 0, z: 0, r: 20 });
    let expected = 0;
    for (let x = -20; x <= 20; x += 4) {
      for (let z = -20; z <= 20; z += 4) if (Math.hypot(x, z) <= 20) expected++;
    }
    // 81 blocks; the old fixed -16..16 grid stopped at 79, missing the rim
    // blocks on the axes, which the sim still lifted.
    expect(wide).toHaveLength(expected);
    expect(wide).toHaveLength(81);
    for (const [x, z] of [
      [20, 0],
      [-20, 0],
      [0, 20],
      [0, -20],
    ]) {
      expect(wide.some((b) => b.x === x && b.z === z)).toBe(true);
    }
    for (const b of wide) expect(Math.hypot(b.x, b.z)).toBeLessThanOrEqual(20);
  });

  it('hashes positions into [0, 1) stably', () => {
    expect(hash2(0, 0)).toBe(0);
    // Literal pins: a changed multiplier re-rolls every dais block in the game.
    expect(hash2(4, 8)).toBeCloseTo(0.6161671252266387, 12);
    expect(hash2(-12, 16)).toBeCloseTo(0.2043001390952668, 12);
    for (const [a, b] of [
      [4, 8],
      [-12, 16],
      [3.5, -7.25],
    ]) {
      const h = hash2(a, b);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
      expect(hash2(a, b)).toBe(h);
    }
    expect(hash2(4, 8)).not.toBe(hash2(8, 4));
  });
});
