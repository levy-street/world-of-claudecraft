// The Hoarshelf's frozen-lake ice sheets (quartered_lake_ice_core.ts).
// Node-only (RENDER_PURE_CORES): no Three, no DOM.
import { describe, expect, it } from 'vitest';
import {
  LAKE_ICE_ALPHA,
  LAKE_ICE_COLORS,
  LAKE_ICE_FADE,
  LAKE_ICE_INSET,
  LAKE_ICE_LIFT,
  LAKE_ICE_RINGS,
  LAKE_ICE_SEGMENTS,
  LAKE_ICE_TEXTURE_SIZE,
  lakeIceDisc,
  lakeIceTexels,
} from '../src/render/quartered_lake_ice_core';
import { frozenLakeAt, QUARTERED_FROZEN_LAKES } from '../src/sim/quartered_landmarks';
import { terrainHeight } from '../src/sim/world';

describe('the frozen lake ice sheet', () => {
  it('lays a level disc just over every lake, inside its edge, on its level ground', () => {
    expect(QUARTERED_FROZEN_LAKES.length).toBeGreaterThanOrEqual(4);
    for (const lake of QUARTERED_FROZEN_LAKES) {
      const disc = lakeIceDisc(lake);
      const n = disc.positions.length / 3;
      expect(n).toBe(1 + LAKE_ICE_RINGS * LAKE_ICE_SEGMENTS);
      for (let v = 0; v < n; v++) {
        const x = disc.positions[v * 3];
        const y = disc.positions[v * 3 + 1];
        const z = disc.positions[v * 3 + 2];
        expect(y).toBeCloseTo(lake.y + LAKE_ICE_LIFT, 5);
        expect(Math.hypot(x - lake.x, z - lake.z)).toBeLessThanOrEqual(
          lake.r - LAKE_ICE_INSET + 1e-3,
        );
        // every vertex is over the lake the sim slides a player on
        expect(frozenLakeAt(x, z)).toBe(lake);
        // and the terrain under it is the lake's level ground, just below
        expect(Math.abs(terrainHeight(x, z, 0) - lake.y)).toBeLessThan(0.02);
      }
    }
  });

  it('fades only its outer band to clear', () => {
    const lake = QUARTERED_FROZEN_LAKES[0];
    const disc = lakeIceDisc(lake);
    const outer = lake.r - LAKE_ICE_INSET;
    for (let v = 0; v < disc.colors.length / 4; v++) {
      const d = Math.hypot(disc.positions[v * 3] - lake.x, disc.positions[v * 3 + 2] - lake.z);
      const alpha = disc.colors[v * 4 + 3];
      if (d > outer - 1e-3) {
        expect(alpha).toBe(0);
      } else {
        expect(alpha).toBeCloseTo(LAKE_ICE_ALPHA, 6);
        expect(d).toBeLessThanOrEqual(outer - LAKE_ICE_FADE + 1e-3);
      }
    }
  });

  it('winds every triangle up, with valid indices', () => {
    const disc = lakeIceDisc(QUARTERED_FROZEN_LAKES[1]);
    expect(disc.indices.length / 3).toBe(LAKE_ICE_SEGMENTS * (1 + 2 * (LAKE_ICE_RINGS - 1)));
    const p = disc.positions;
    const n = p.length / 3;
    for (let k = 0; k < disc.indices.length; k += 3) {
      const a = disc.indices[k];
      const b = disc.indices[k + 1];
      const c = disc.indices[k + 2];
      for (const i of [a, b, c]) expect(i).toBeLessThan(n);
      const ux = p[b * 3] - p[a * 3];
      const uz = p[b * 3 + 2] - p[a * 3 + 2];
      const wx = p[c * 3] - p[a * 3];
      const wz = p[c * 3 + 2] - p[a * 3 + 2];
      expect(uz * wx - ux * wz).toBeGreaterThan(0);
    }
  });

  it('paints pale glassy ice crossed by deep blue cracks, never snow white or warm', () => {
    const size = 64;
    const tex = lakeIceTexels(size);
    expect(tex.length).toBe(size * size * 4);
    expect(lakeIceTexels(size)).toEqual(tex);
    // a power of two, so the full-size texture mips
    expect(LAKE_ICE_TEXTURE_SIZE & (LAKE_ICE_TEXTURE_SIZE - 1)).toBe(0);
    let cracked = 0;
    let clear = 0;
    for (let i = 0; i < size * size; i++) {
      const r = tex[i * 4];
      const b = tex[i * 4 + 2];
      expect(tex[i * 4 + 3]).toBe(255);
      // black ice: blue always leads red, the body dark as still water
      expect(b).toBeGreaterThan(r);
      if (b > 90) cracked++;
      if (r < 40) clear++;
    }
    expect(clear / (size * size)).toBeGreaterThan(0.5);
    expect(cracked / (size * size)).toBeGreaterThan(0.02);
    expect(cracked / (size * size)).toBeLessThan(0.35);
    expect(LAKE_ICE_COLORS.crack[2]).toBeGreaterThan(LAKE_ICE_COLORS.crack[0] * 3);
  });

  it('tiles without a seam: the wrap edge differs no more than the roughest inner pair', () => {
    const size = 128;
    const tex = lakeIceTexels(size);
    const blue = (x: number, y: number) => tex[(y * size + x) * 4 + 2];
    // the summed difference between column x and x + 1 (wrapping), and the
    // same for rows: a seam would make the wrap pair the outlier
    const colPair = (x: number) => {
      let sum = 0;
      for (let k = 0; k < size; k++) sum += Math.abs(blue((x + 1) % size, k) - blue(x, k));
      return sum;
    };
    const rowPair = (y: number) => {
      let sum = 0;
      for (let k = 0; k < size; k++) sum += Math.abs(blue(k, (y + 1) % size) - blue(k, y));
      return sum;
    };
    let colMax = 0;
    let rowMax = 0;
    for (let k = 0; k < size - 1; k++) {
      colMax = Math.max(colMax, colPair(k));
      rowMax = Math.max(rowMax, rowPair(k));
    }
    expect(colPair(size - 1)).toBeLessThanOrEqual(colMax);
    expect(rowPair(size - 1)).toBeLessThanOrEqual(rowMax);
  });
});
