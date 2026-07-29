import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_WORLD, CAMPS, setActiveWorldContent } from '../src/sim/data';
import { moveSpeedMult, type PlayerMotionDeps, stepPlayerMotion } from '../src/sim/player_motion';
import { Sim } from '../src/sim/sim';
import { emptyZoneProps, type MoveInput, type WorldContent } from '../src/sim/types';
import { computeBorderEdges, terrainHeight, WATER_LEVEL } from '../src/sim/world';

// Terrain-generation guarantees for declared water bodies (the generator-side
// follow-up to the movement fix pinned by tests/water_escape.test.ts):
//
// 1. Gradual shores: the shore-grading pass in terrainHeight compresses the
//    height profile around the waterline inside every declared lake footprint,
//    so a player who swims or wades to shore can WALK out. The proof is end to
//    end: the real movement kernel is driven out of every declared lake in 16
//    directions, at BOTH the test seed and the production seed. Without the
//    grading pass a couple hundred of those rays dead-end on steep shores;
//    with it only the deliberate set-piece cliffs remain (the Hollow's falls
//    lip and sealed moat walls), every lake keeps at least 7 of 16 directions
//    freely walkable, and no lake is ever a trap.
// 2. Even seam beds: where a zone border crosses a declared lake, the
//    non-sealed border ridge breaks across the whole water disc
//    (lakeRidgeGateAt), so the ground under water where two maps meet is an
//    even, swimmable basin, not a mountain range. Sealed borders are exempt:
//    the realm wall stands even where a lake abuts it.

const SEEDS = [42, 20061]; // the suite's default seed and the production seed
const DIRS = 16;
// Every lake stays walk-out-able in at least this many directions (the worst
// builtin lake, the Hollow's falls basin, measures 7 at the production seed;
// its remaining blocked rays are the authored falls lip and moat walls)...
const MIN_OPEN_DIRS = 7;
// ...and across the whole world only those set pieces may block (28 and 33
// rays at the two seeds today; a couple hundred without the grading pass, so
// this bound fails hard if the grading regresses).
const MAX_BLOCKED_TOTAL = 40;

afterEach(() => setActiveWorldContent(null));

const mi: MoveInput = {
  forward: true,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
  dive: false,
  surface: false,
};

function kernelDeps(seed: number): PlayerMotionDeps {
  return {
    seed,
    moveSpeedMult: (e) => moveSpeedMult(e, 0),
    resolveMove: (_fx, _fz, nx, nz) => ({ x: nx, z: nz }),
    resolvedAbility: () => null,
    cancelCast: () => {},
    standUp: () => {},
    dealDamage: () => {},
  };
}

// Drive the real movement kernel from the lake center outward; an escape is
// standing on dry ground clear of the water. This measures TERRAIN, not props,
// which is why makeSim below strips the authored prop tables: the open-world
// arm of stepPlayerMotion resolves through the physics kernel's own collider
// broadphase (src/sim/physics/character.ts), not through PlayerMotionDeps
// .resolveMove, so a pass-through dep can no longer make the measurement
// prop-free. Stripping the props is the honest replacement, and it keeps the
// end-to-end claim: the REAL kernel is still what walks out of every lake.
// (The Hollow's falls basin is the case that forced this: its centrepiece prop
// is a 4.6 yd disc sitting exactly on the lake anchor, so with props active the
// actor starts every ray already inside a collider.)
function blockedDirections(
  sim: Sim,
  seed: number,
  lake: { x: number; z: number; radius: number },
): number[] {
  const deps = kernelDeps(seed);
  const blocked: number[] = [];
  for (let k = 0; k < DIRS; k++) {
    const actor = {
      ...sim.player,
      pos: { x: lake.x, y: 0, z: lake.z },
      prevPos: { x: lake.x, y: 0, z: lake.z },
      facing: (k / DIRS) * Math.PI * 2,
      onGround: true,
      vx: 0,
      vy: 0,
      vz: 0,
      fallStartY: 0,
    };
    actor.pos.y = terrainHeight(lake.x, lake.z, seed);
    actor.prevPos = { ...actor.pos };
    actor.fallStartY = actor.pos.y;
    let out = false;
    for (let t = 0; t < 20 * 20; t++) {
      actor.prevPos = { ...actor.pos };
      stepPlayerMotion(deps, actor, mi);
      if (
        actor.onGround &&
        terrainHeight(actor.pos.x, actor.pos.z, seed) > WATER_LEVEL + 0.05 &&
        Math.hypot(actor.pos.x - lake.x, actor.pos.z - lake.z) > lake.radius * 0.6
      ) {
        out = true;
        break;
      }
    }
    if (!out) blocked.push(k);
  }
  return blocked;
}

function terrainOnlyWorld(world: WorldContent): WorldContent {
  // Zones (and therefore lakes and the shore grading under test) stay exactly
  // as authored; only the prop tables the collider grid reads are emptied.
  return { ...world, props: emptyZoneProps() };
}

function makeSim(world: WorldContent, seed: number): Sim {
  const terrainOnly = terrainOnlyWorld(world);
  setActiveWorldContent(terrainOnly);
  return new Sim({
    seed,
    playerClass: 'warrior',
    autoEquip: true,
    world: { ...terrainOnly, camps: [], npcs: {}, groundObjects: [] },
  });
}

describe('every declared lake can be walked out of (terrain generation)', () => {
  for (const seed of SEEDS) {
    it(`the movement kernel escapes every lake in most directions (seed ${seed})`, () => {
      const sim = makeSim(BUILTIN_WORLD, seed);
      let total = 0;
      const rows: string[] = [];
      for (const zone of BUILTIN_WORLD.zones) {
        for (const lake of zone.lakes) {
          const blocked = blockedDirections(sim, seed, lake);
          total += blocked.length;
          if (blocked.length > 0) {
            rows.push(
              `${zone.name} (${lake.x},${lake.z},r${lake.radius}): ${blocked.length}/${DIRS}`,
            );
          }
          expect(
            DIRS - blocked.length,
            `${zone.name} lake (${lake.x},${lake.z}) open directions`,
          ).toBeGreaterThanOrEqual(MIN_OPEN_DIRS);
        }
      }
      expect(total, `blocked escape rays world-wide:\n${rows.join('\n')}`).toBeLessThanOrEqual(
        MAX_BLOCKED_TOTAL,
      );
    }, 60_000);
  }

  it('a border ridge breaks where a declared lake crosses a zone border', () => {
    const SEED = 42;
    // Drop a lake dead on a real non-sealed border edge, clear of its road
    // pass and of every camp flatten, and assert the seam under the water is
    // an even swimmable bed with walk-out shores, not a mountain range.
    const edge = computeBorderEdges(BUILTIN_WORLD.zones).find(
      (e) => e.kind === 'h' && !e.sealed && e.hi - e.lo > 200,
    );
    if (!edge) throw new Error('no wide unsealed horizontal border edge');
    const R = 20;
    let cx = Number.NaN;
    for (let x = edge.lo + 40; x <= edge.hi - 40; x += 5) {
      if (Math.abs(x - edge.passAt) < 54 + R) continue;
      const clearOfCamps = CAMPS.every(
        (c) => Math.hypot(x - c.center.x, edge.at - c.center.z) > c.radius * 1.8 + R * 1.6,
      );
      if (clearOfCamps) {
        cx = x;
        break;
      }
    }
    if (Number.isNaN(cx)) throw new Error('no camp-free spot on the border');
    const cz = edge.at;

    // without the lake, the border here is a mountain wall
    setActiveWorldContent(BUILTIN_WORLD);
    expect(terrainHeight(cx, cz, SEED)).toBeGreaterThan(WATER_LEVEL + 5);

    const zones = BUILTIN_WORLD.zones.map((z, i) =>
      i === 0 ? { ...z, lakes: [...z.lakes, { x: cx, z: cz, radius: R }] } : z,
    );
    const world: WorldContent = { ...BUILTIN_WORLD, zones };
    const sim = makeSim(world, SEED);

    // the seam bed is under water and swimmable along the whole crossing...
    for (let dx = -R * 0.75; dx <= R * 0.75; dx += 1) {
      const h = terrainHeight(cx + dx, cz, SEED);
      expect(h, `seam bed at dx ${dx}`).toBeLessThan(WATER_LEVEL - 0.8);
    }
    // ...no mountain flank stands anywhere inside the water footprint (the
    // graded shore itself rises gently past the waterline toward the disc
    // edge, staying a low bank; the pre-gate ridge ring measured 20yd above
    // the waterline here)...
    for (let dx = -R * 1.6; dx <= R * 1.6; dx += 2) {
      const h = terrainHeight(cx + dx, cz, SEED);
      expect(h, `ridge flank in the water at dx ${dx}`).toBeLessThan(WATER_LEVEL + 6);
    }
    // ...and the kernel walks out of the seam lake in every direction,
    // including straight across the border
    expect(blockedDirections(sim, SEED, { x: cx, z: cz, radius: R })).toEqual([]);
  });

  it('a sealed border wall stands even where a lake abuts it', () => {
    const SEED = 42;
    const sealed = computeBorderEdges(BUILTIN_WORLD.zones).find((e) => e.kind === 'h' && e.sealed);
    if (!sealed) throw new Error('no sealed border edge');
    const cx = (sealed.lo + sealed.hi) / 2;
    const zones = BUILTIN_WORLD.zones.map((z, i) =>
      i === 0 ? { ...z, lakes: [...z.lakes, { x: cx, z: sealed.at, radius: 15 }] } : z,
    );
    setActiveWorldContent({ ...BUILTIN_WORLD, zones });
    // the sealed range is never gated by water: a tall wall still crosses the
    // lake (the movement seal, crossesSealedBorder, is independent of terrain)
    let crest = -Infinity;
    for (let dz = -20; dz <= 20; dz += 2) {
      crest = Math.max(crest, terrainHeight(cx, sealed.at + dz, SEED));
    }
    expect(crest, 'sealed wall height across the lake').toBeGreaterThan(WATER_LEVEL + 10);
  });

  it('is deterministic: identical heights on identical inputs', () => {
    setActiveWorldContent(BUILTIN_WORLD);
    const probe = (): number[] => {
      const out: number[] = [];
      const lake = BUILTIN_WORLD.zones[0].lakes[0];
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        out.push(
          terrainHeight(
            lake.x + Math.sin(a) * lake.radius * 1.2,
            lake.z + Math.cos(a) * lake.radius * 1.2,
            42,
          ),
        );
      }
      return out;
    };
    expect(probe()).toEqual(probe());
  });
});
