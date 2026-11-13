// The Drakelands fortress and the Last Keep stand on the bare ground they were placed on
// (src/render/fortress_grass_keepout_core.ts): no grass system may root a blade inside
// their walls now that the open Drakelands grows grass.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GRASS_BIOME_DENSITY } from '../src/render/foliage';
import { insidePavedGrassExclusion } from '../src/render/foliage_core';
import {
  FORTRESS_GRASS_PAD,
  FORTRESS_SITE_MIN_Z,
  insideFortressGrassKeepout,
} from '../src/render/fortress_grass_keepout_core';
import { FORGEFATHER_FORTRESS_PLACEMENTS } from '../src/sim/forgefather_fortress';
import { KEEP_SITE } from '../src/sim/keep_site';

const site = FORGEFATHER_FORTRESS_PLACEMENTS.filter((piece) => piece.z >= FORTRESS_SITE_MIN_Z);

describe('fortress grass keep-out', () => {
  it('is needed: the Drakelands grows blades, and pins the reach', () => {
    expect(GRASS_BIOME_DENSITY.ember).toBeGreaterThan(0);
    expect(FORTRESS_GRASS_PAD).toBe(8);
    expect(FORTRESS_SITE_MIN_Z).toBe(2100);
    // both halves of the table are really there: the complex and Wyrmwatch's own pieces
    expect(site.length).toBeGreaterThan(400);
    expect(FORGEFATHER_FORTRESS_PLACEMENTS.length - site.length).toBeGreaterThan(10);
  });

  it('covers every placed piece of the keep and the isle, and the ground beside it', () => {
    for (const piece of site) {
      expect(
        insideFortressGrassKeepout(piece.x, piece.z),
        `${piece.key} at ${piece.x}, ${piece.z}`,
      ).toBe(true);
      expect(insideFortressGrassKeepout(piece.x + 5, piece.z - 5)).toBe(true);
    }
  });

  it('leaves no hole inside the Last Keep: its whole pad is bare, wall to wall', () => {
    const pad = KEEP_SITE.pad;
    const holes: string[] = [];
    for (let x = pad.x0 + 4; x <= pad.x1 - 4; x += 2) {
      for (let z = pad.z0 + 16; z <= pad.z1 - 4; z += 2) {
        if (!insideFortressGrassKeepout(x, z)) holes.push(`${x},${z}`);
      }
    }
    expect(holes).toEqual([]);
  });

  it('gives the open Drakelands and Wyrmwatch their grass', () => {
    const minX = Math.min(...site.map((piece) => piece.x));
    const minZ = Math.min(...site.map((piece) => piece.z));
    // well outside the complex on its landward side
    expect(insideFortressGrassKeepout(minX - 30, minZ + 20)).toBe(false);
    expect(insideFortressGrassKeepout(minX + 20, minZ - 30)).toBe(false);
    // Wyrmwatch's pieces share the table and keep their town turf
    const town = FORGEFATHER_FORTRESS_PLACEMENTS.filter((piece) => piece.z < FORTRESS_SITE_MIN_Z);
    for (const piece of town)
      expect(insideFortressGrassKeepout(piece.x + 3, piece.z + 3)).toBe(false);
    // and the far side of the map is four comparisons away from any of it
    expect(insideFortressGrassKeepout(0, 0)).toBe(false);
  });

  it('is asked by every grass system through the paved-ground exclusion', () => {
    const inside = site[Math.floor(site.length / 2)];
    expect(insidePavedGrassExclusion(inside.x, inside.z)).toBe(true);
    const core = readFileSync(new URL('../src/render/foliage_core.ts', import.meta.url), 'utf8');
    expect(core).toContain('if (insideFortressGrassKeepout(x, z)) return true;');
    for (const file of ['blade_grass.ts', 'blade_grass_band.ts', 'foliage.ts']) {
      const source = readFileSync(new URL(`../src/render/${file}`, import.meta.url), 'utf8');
      expect(source, file).toContain('insidePavedGrassExclusion(x, z)');
    }
  });
});
