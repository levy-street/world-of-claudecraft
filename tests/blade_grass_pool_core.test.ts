import { describe, expect, it } from 'vitest';
import {
  insidePoolDisc,
  poolDiscCenter,
  poolDiscJitteredLimitSq,
  poolDiscLimitSq,
} from '../src/render/blade_grass_pool_core';

// The two live pools, from GFX.bladeCarpetRadius at ultra and meadow_tuning.
const CARPET = { radius: 34, cell: 0.46 };
const BAND = { radius: 120, cell: 1.25 };

const gridWidth = (radius: number, cell: number): number => Math.ceil((radius * 2) / cell);

describe('blade grass pool disc', () => {
  it('recovers the player cell centre from the block base on either parity', () => {
    for (const gridW of [148, 149]) {
      for (const px of [0, 3.7, -12.25, 501.9]) {
        const cell = 0.46;
        const base = Math.floor(px / cell) - (gridW >> 1);
        const center = poolDiscCenter(base, gridW, cell);
        // the player never leaves its own cell while this block is current
        expect(Math.abs(px - center)).toBeLessThanOrEqual(cell / 2 + 1e-9);
      }
    }
  });

  it('never rejects a cell the shader could still draw', () => {
    // The shader fades on distance(instance, LIVE player); a cell survives the
    // gate whenever that distance can be under the radius from anywhere in the
    // player's own cell. Sweep the worst case: the player in the far corner of
    // its cell, the cluster jittered toward it.
    const { radius, cell } = CARPET;
    const limitSq = poolDiscLimitSq(radius, cell);
    const gridW = gridWidth(radius, cell);
    const base = -(gridW >> 1);
    const centerX = poolDiscCenter(base, gridW, cell);
    const centerZ = poolDiscCenter(base, gridW, cell);
    let checked = 0;
    for (let a = 0; a < 720; a++) {
      const ang = (a / 720) * Math.PI * 2;
      // a cluster exactly at the fade radius from the worst-case player corner
      for (const cornerX of [-cell / 2, cell / 2]) {
        for (const cornerZ of [-cell / 2, cell / 2]) {
          const px = centerX + cornerX;
          const pz = centerZ + cornerZ;
          const x = px + Math.cos(ang) * (radius - 1e-6);
          const z = pz + Math.sin(ang) * (radius - 1e-6);
          expect(insidePoolDisc(x, z, centerX, centerZ, limitSq)).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBe(2880);
  });

  it('rejects about a fifth of each square pool', () => {
    for (const { radius, cell } of [CARPET, BAND]) {
      const gridW = gridWidth(radius, cell);
      const limitSq = poolDiscLimitSq(radius, cell);
      const base = -(gridW >> 1);
      const centerX = poolDiscCenter(base, gridW, cell);
      const centerZ = poolDiscCenter(base, gridW, cell);
      let kept = 0;
      for (let gj = 0; gj < gridW; gj++) {
        for (let gi = 0; gi < gridW; gi++) {
          const x = (base + gi) * cell;
          const z = (base + gj) * cell;
          if (insidePoolDisc(x, z, centerX, centerZ, limitSq)) kept++;
        }
      }
      const rejected = 1 - kept / (gridW * gridW);
      expect(rejected).toBeGreaterThan(0.19);
      expect(rejected).toBeLessThan(0.23);
    }
  });

  it('widens the limit by the placement jitter for nominal cell centres', () => {
    const { radius, cell } = BAND;
    expect(poolDiscJitteredLimitSq(radius, cell)).toBeGreaterThan(poolDiscLimitSq(radius, cell));
    // a cluster jittered by the full 0.65 cell on both axes stays admissible
    // under the widened limit when its nominal centre is on the tight rim
    const tight = Math.sqrt(poolDiscLimitSq(radius, cell));
    const wide = poolDiscJitteredLimitSq(radius, cell);
    const nx = tight / Math.SQRT2;
    const nz = tight / Math.SQRT2;
    expect(insidePoolDisc(nx + 0.65 * cell, nz + 0.65 * cell, 0, 0, wide)).toBe(true);
  });
});

describe('blade grass pool disc wiring', () => {
  it('gates both live pools ahead of their terrain samples', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['blade_grass.ts', 'blade_grass_band.ts']) {
      const source = readFileSync(new URL(`../src/render/${file}`, import.meta.url), 'utf8');
      expect(source).toContain('const discLimitSq = poolDiscLimitSq(RADIUS, CELL);');
      expect(source).toContain('discCenterX = poolDiscCenter(baseI, GRID_W, CELL);');
      expect(source).toContain('discCenterZ = poolDiscCenter(baseJ, GRID_W, CELL);');
      const gate = source.indexOf('insidePoolDisc(x, z, discCenterX, discCenterZ, discLimitSq)');
      const terrain = source.indexOf('const h = terrainHeight(x, z, seed);');
      expect(gate).toBeGreaterThan(0);
      expect(terrain).toBeGreaterThan(gate);
    }
  });
});
