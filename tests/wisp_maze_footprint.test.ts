// The wisp maze trial's ground stays its own. The maze is drawn only for the
// player inside it, but it stands in the open Evergarden, so anything the world
// builds, grows or collides with inside its footprint shows through its hedges
// or blocks a corridor: this pins the footprint clear of every static collider,
// placed prop, great tree root flare, scatter decoration, road lamp and garden
// planting, and the lawn under it level (sim/wisp_maze_ground.ts).
import { describe, expect, it } from 'vitest';
import {
  gardenLushGrassAt,
  gardenMeadowTintAt,
  parterreBushSpots,
  parterreFlowerTintAt,
} from '../src/render/garden_parterre_core';
import { WISP_MAZE_WALL_CELLS, WISP_MAZE_WORLD_CELLS } from '../src/render/wisp_maze_core';
import { colliderBounds } from '../src/sim/collider_cells';
import {
  type Collider,
  colliderInternalsForTest,
  streetlampPlacements,
} from '../src/sim/colliders';
import { EVERGARDEN_PROPS } from '../src/sim/content/evergarden';
import { WISP_MAZE_SITE } from '../src/sim/content/world_quest_wisp_maze';
import { WISP_MAZE_LAYOUT } from '../src/sim/minigames/wisp_maze';
import {
  applyWispMazePad,
  inWispMazeFootprint,
  WISP_MAZE_FOOTPRINT,
  WISP_MAZE_PAD,
  wispMazeFootprintDistance,
} from '../src/sim/wisp_maze_ground';
import { generateDecorationsInBounds, terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

/** Clear lawn kept past the maze's outer hedge faces, in yards. */
const MARGIN = 1;
const f = WISP_MAZE_FOOTPRINT;

describe('the wisp maze footprint', () => {
  it('is the outer edge of the maze grid, around the site', () => {
    const half = (WISP_MAZE_LAYOUT.cols * WISP_MAZE_LAYOUT.pitch) / 2;
    expect(f).toEqual({
      x0: WISP_MAZE_SITE.x - half,
      x1: WISP_MAZE_SITE.x + half,
      z0: WISP_MAZE_SITE.z - half,
      z1: WISP_MAZE_SITE.z + half,
    });
    for (const cell of WISP_MAZE_WALL_CELLS) {
      const at = WISP_MAZE_WORLD_CELLS[cell];
      expect(inWispMazeFootprint(at.x, at.z)).toBe(true);
    }
    expect(wispMazeFootprintDistance(f.x1 + 3, WISP_MAZE_SITE.z)).toBeCloseTo(3);
    expect(wispMazeFootprintDistance(WISP_MAZE_SITE.x, WISP_MAZE_SITE.z)).toBe(0);
  });

  it('crosses no static collider', () => {
    // Nearest approach of each collider's real shape to the footprint rect.
    const reach = (c: Collider): number => {
      if (c.type === 'circle') return wispMazeFootprintDistance(c.x, c.z) - c.r;
      let best = Number.POSITIVE_INFINITY;
      const cos = Math.cos(c.rot);
      const sin = Math.sin(c.rot);
      for (let u = -1; u <= 1; u += 0.05) {
        for (const [lx, lz] of [
          [u * c.hw, -c.hd],
          [u * c.hw, c.hd],
          [-c.hw, u * c.hd],
          [c.hw, u * c.hd],
        ]) {
          // three's rotation.y: x' = x cos + z sin, z' = -x sin + z cos
          const x = c.x + lx * cos + lz * sin;
          const z = c.z - lx * sin + lz * cos;
          best = Math.min(best, inWispMazeFootprint(x, z) ? -1 : wispMazeFootprintDistance(x, z));
        }
      }
      return best;
    };
    const near = colliderInternalsForTest.staticWorldColliders(WORLD_SEED).filter((c) => {
      const b = colliderBounds(c);
      return b.maxX > f.x0 - 8 && b.minX < f.x1 + 8 && b.maxZ > f.z0 - 8 && b.minZ < f.z1 + 8;
    });
    // Non-vacuous: the Great Maze's east hedge (x 425) and the east flower beds
    // stand close by, just clear of the trial's outer hedge faces.
    expect(near.length).toBeGreaterThan(3);
    for (const c of near) expect(reach(c), JSON.stringify(c)).toBeGreaterThan(0.5);
  });

  it('holds no placed prop, and no great tree reaches it with its roots', () => {
    for (const [key, list] of Object.entries(EVERGARDEN_PROPS)) {
      if (!Array.isArray(list)) continue;
      for (const prop of list as { x?: unknown; z?: unknown; r?: number }[]) {
        if (typeof prop?.x !== 'number' || typeof prop.z !== 'number') continue;
        expect(
          wispMazeFootprintDistance(prop.x, prop.z) - (prop.r ?? 0),
          `${key} at ${prop.x},${prop.z}`,
        ).toBeGreaterThan(MARGIN * 0.5);
      }
    }
    // The elders are drawn at r x (2.4 to 2.9) scale, and the model's root flare
    // spreads 1.57 model units: a 2.6 elder's roots reach about 11.8 yards.
    for (const tree of EVERGARDEN_PROPS.greatTrees ?? []) {
      expect(
        wispMazeFootprintDistance(tree.x, tree.z),
        `great tree ${tree.x},${tree.z}`,
      ).toBeGreaterThan(tree.r * 2.9 * 1.6 + MARGIN);
    }
  });

  it('grows no scatter, road lamp, road-edge hedge, flower or lush grass', () => {
    expect(
      generateDecorationsInBounds(WORLD_SEED, {
        minX: f.x0 - MARGIN,
        maxX: f.x1 + MARGIN,
        minZ: f.z0 - MARGIN,
        maxZ: f.z1 + MARGIN,
      }),
    ).toEqual([]);
    expect(
      streetlampPlacements(WORLD_SEED).filter((lamp) =>
        inWispMazeFootprint(lamp.x, lamp.z, MARGIN),
      ),
    ).toEqual([]);
    // The long east walk runs through the site: its hedge line broke here and
    // stood down the trial's corridors.
    expect(
      parterreBushSpots(WORLD_SEED).filter((bush) => inWispMazeFootprint(bush.x, bush.z, MARGIN)),
    ).toEqual([]);
    for (let x = f.x0 - MARGIN + 0.25; x < f.x1 + MARGIN; x += 0.5) {
      for (let z = f.z0 - MARGIN + 0.25; z < f.z1 + MARGIN; z += 0.5) {
        expect(parterreFlowerTintAt(x, z), `flower ${x},${z}`).toBe(-1);
        expect(gardenMeadowTintAt(x, z), `meadow ${x},${z}`).toBe(-1);
        expect(gardenLushGrassAt(x, z), `grass ${x},${z}`).toBe(false);
      }
    }
  });

  it('is level lawn (a hedge must not bury one side and float the other)', () => {
    // Level with the east flower-bed terrace it borders (that ensemble's
    // anchor finishes at 4.79 on the shipped seed), so the two meet flush.
    const terrace = terrainHeight(WISP_MAZE_PAD.anchorX, WISP_MAZE_PAD.anchorZ, WORLD_SEED);
    expect(terrace).toBeCloseTo(4.79, 2);
    for (let x = f.x0; x <= f.x1; x += 1) {
      for (let z = f.z0; z <= f.z1; z += 1) {
        expect(terrainHeight(x, z, WORLD_SEED), `${x},${z}`).toBeCloseTo(terrace, 6);
      }
    }
    // Its skirt eases back to the natural lawn, and nothing past it moves.
    const anchor = () => 5;
    expect(applyWispMazePad(f.x1 + WISP_MAZE_PAD.skirt, WISP_MAZE_SITE.z, 9, anchor)).toBe(9);
    expect(applyWispMazePad(f.x1 + 30, WISP_MAZE_SITE.z, 9, () => Number.NaN)).toBe(9);
    expect(
      applyWispMazePad(f.x1 + WISP_MAZE_PAD.skirt / 2, WISP_MAZE_SITE.z, 9, anchor),
    ).toBeCloseTo(7);
    expect(applyWispMazePad(WISP_MAZE_SITE.x, WISP_MAZE_SITE.z, 9, anchor)).toBe(5);
    for (let x = f.x0 - 8; x <= f.x1 + 8; x += 0.5) {
      const step = Math.abs(
        terrainHeight(x + 0.5, WISP_MAZE_SITE.z, WORLD_SEED) -
          terrainHeight(x, WISP_MAZE_SITE.z, WORLD_SEED),
      );
      expect(step, `skirt slope at ${x}`).toBeLessThan(0.6);
    }
  });
});
