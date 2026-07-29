// The Palmreach jungle-pool walkway (sim/reach_decks.ts indices 4 and 5: the
// viewing platform off the pool's east rim and the stair climbing the tangle
// side behind it) must never wedge a player: walking on, off, up, down, or
// stepping over an edge always leaves a way out.
//
// The reported bug was a total freeze at (-373, 1003), standing on the
// platform. A deck's plank plane is walkable raised ground (world.ts
// groundHeight takes the max of terrain and the deck surface), but the
// movement kernel reads two DIFFERENT surfaces when it decides whether the
// player is on unwalkable ground: rideSteepnessAt defers to the memoized
// TERRAIN steepness on dry land (so the pool rim buried under the planks
// stripped all steering), while terrainDownhill and terrainWallStandoff read
// groundHeight, which over a LEVEL deck is a dead-flat plane (so there was no
// downhill to slide along and no wall to be pushed off). The player was
// frozen for good. The pool rim is eased under the walkway so no cell the
// planks cover reaches the climb limit.

import { describe, expect, it } from 'vitest';
import { resolveMovement } from '../src/sim/colliders';
import { GALE_DECK_FREEBOARD, galeDeckSurfaceAt } from '../src/sim/gale_harbor';
import { PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { type PlayerMotionDeps, stepPlayerMotion } from '../src/sim/player_motion';
import { REACH_DECKS, reachDeckSurface } from '../src/sim/reach_decks';
import { Sim } from '../src/sim/sim';
import type { Entity, MoveInput } from '../src/sim/types';
import { groundHeight, terrainHeight, terrainSteepness, WATER_LEVEL } from '../src/sim/world';

// The shipped seed: the report is seed-pinned world geometry.
const SEED = 20061;
// The viewing platform and its stair; the rest of REACH_DECKS is elsewhere.
const PLATFORM = REACH_DECKS[4];
const STAIR = REACH_DECKS[5];

// The scanned rect: the whole walkway complex plus the pool rim, the beach
// apron below it, and the tangle-side bank the stair climbs.
const RECT = { x1: -382, x2: -356, z1: 988, z2: 1014 };

const terrain = (x: number, z: number): number => terrainHeight(x, z, SEED);

// --- a walker on the shared movement kernel --------------------------------
// player_motion.ts is the one kernel the offline Sim, the authoritative
// server, and the client self-predictor all run, so a probe driven through it
// is exactly what a real player's body does. Driving it directly (rather than
// a whole Sim tick) keeps the exhaustive sweep below fast enough to cover the
// rect at half-yard spacing.

const deps: PlayerMotionDeps = {
  seed: SEED,
  moveSpeedMult: () => 1,
  resolveMove: (fx, fz, nx, nz, r, _e, ignoreFences) =>
    resolveMovement(SEED, fx, fz, nx, nz, r, ignoreFences),
  resolvedAbility: () => null,
  cancelCast: () => {},
  standUp: () => {},
  dealDamage: () => {},
};

const NO_INPUT: MoveInput = {
  forward: false,
  back: false,
  strafeLeft: false,
  strafeRight: false,
  turnLeft: false,
  turnRight: false,
  jump: false,
};

let walkerBody: Entity | null = null;
function bodyForWalking(): Entity {
  if (!walkerBody) {
    const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
    sim.setPlayerLevel(20);
    walkerBody = sim.player;
  }
  return walkerBody;
}

function standAt(p: Entity, x: number, z: number): void {
  p.pos.x = x;
  p.pos.z = z;
  p.pos.y = groundHeight(x, z, SEED);
  p.prevPos = { ...p.pos };
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  p.onGround = true;
  p.jumping = false;
  p.fallStartY = p.pos.y;
  p.auras.length = 0;
}

/** How far a player starting at (x, z) gets, over `azimuths` fixed headings. */
function escapeDistance(
  x: number,
  z: number,
  azimuths: number,
  ticks: number,
  want: number,
): number {
  const p = bodyForWalking();
  const inp: MoveInput = { ...NO_INPUT, forward: true };
  let best = 0;
  for (let k = 0; k < azimuths; k++) {
    standAt(p, x, z);
    const facing = (k * 2 * Math.PI) / azimuths;
    for (let i = 0; i < ticks; i++) {
      p.facing = facing;
      p.prevPos = { ...p.pos };
      stepPlayerMotion(deps, p, inp);
    }
    best = Math.max(best, Math.hypot(p.pos.x - x, p.pos.z - z));
    if (best > want) break; // an escape is an escape; stop paying for the rest
  }
  return best;
}

// A spot escapes when some heading walks the player clear of the complex. 12
// yards is well past the widest deck (the stair is 14.6 long by 3.6 wide), so
// clearing it means the player left the walkway, not shuffled along it.
const ESCAPE_YARDS = 12;

/** Coarse sweep first, then a long 24-heading confirmation on the survivors. */
function isWedge(x: number, z: number): boolean {
  if (escapeDistance(x, z, 8, 120, ESCAPE_YARDS) > ESCAPE_YARDS) return false;
  return escapeDistance(x, z, 24, 400, ESCAPE_YARDS) <= ESCAPE_YARDS;
}

function scanWedges(step: number): { x: number; z: number }[] {
  const found: { x: number; z: number }[] = [];
  for (let z = RECT.z1; z <= RECT.z2 + 1e-9; z += step) {
    for (let x = RECT.x1; x <= RECT.x2 + 1e-9; x += step) {
      if (isWedge(x, z)) found.push({ x, z });
    }
  }
  return found;
}

// --- a walker on the real Sim ----------------------------------------------

function makeSimWalker(spot: { x: number; z: number }) {
  const sim = new Sim({ seed: SEED, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  const p = sim.player;
  const meta = (
    sim as unknown as { players: Map<number, { moveInput: { forward: boolean } }> }
  ).players.get((sim as unknown as { playerId: number }).playerId)!;
  p.pos.x = spot.x;
  p.pos.z = spot.z;
  p.pos.y = groundHeight(spot.x, spot.z, SEED) + 0.05;
  p.prevPos = { ...p.pos };
  for (let i = 0; i < 20; i++) sim.tick();
  return { sim, p, meta };
}

/** Steers a live player through the waypoints, the way a real player walks. */
function walkRoute(
  start: { x: number; z: number },
  waypoints: { x: number; z: number }[],
): { completed: boolean; reached: number; stalledAt: { x: number; z: number } } {
  const { sim, p, meta } = makeSimWalker(start);
  let wp = 0;
  for (let i = 0; i < 20 * 120 && wp < waypoints.length; i++) {
    const t = waypoints[wp];
    p.facing = Math.atan2(t.x - p.pos.x, t.z - p.pos.z);
    meta.moveInput.forward = true;
    // the question is terrain, not combat: the walker heals through the local
    // wildlife so a mob pile-up never reads as a walkway trap
    p.hp = p.maxHp;
    (p as unknown as { dead: boolean }).dead = false;
    sim.tick();
    if (Math.hypot(t.x - p.pos.x, t.z - p.pos.z) < 2) wp++;
  }
  meta.moveInput.forward = false;
  return {
    completed: wp >= waypoints.length,
    reached: wp,
    stalledAt: { x: p.pos.x, z: p.pos.z },
  };
}

// The clifftop path above the stair, down the treads, across the platform,
// off onto the beach and out to the open strand.
const CLIFFTOP = { x: -358.5, z: 992.5 };
const DOWN_ROUTE = [
  { x: -361, z: 994.4 },
  { x: -364, z: 996.9 },
  { x: -368, z: 1000.2 },
  { x: -371.4, z: 1002.9 },
  { x: -372, z: 1004 },
  { x: -370.8, z: 1006.6 },
  { x: -369, z: 1010 },
  { x: -368, z: 1014 },
];
const BEACH = DOWN_ROUTE[DOWN_ROUTE.length - 1];
const UP_ROUTE = [...DOWN_ROUTE].slice(0, -1).reverse().concat([CLIFFTOP]);

// --- edge step-offs ---------------------------------------------------------
// Every point 0.3yd outside a deck's rectangle, all the way round both decks:
// where a player who walks through the (cosmetic) railing lands.
function edgeStepOffs(): { x: number; z: number; label: string }[] {
  const out: { x: number; z: number; label: string }[] = [];
  for (const [i, d] of [PLATFORM, STAIR].entries()) {
    const name = i === 0 ? 'platform' : 'stair';
    const dirx = Math.sin(d.rot);
    const dirz = Math.cos(d.rot);
    const pad = 0.3;
    for (let a = -d.hl; a <= d.hl + 1e-9; a += d.hl / 4) {
      for (const side of [1, -1]) {
        out.push({
          x: d.x + dirx * a + dirz * (d.hw + pad) * side,
          z: d.z + dirz * a - dirx * (d.hw + pad) * side,
          label: `${name} side ${side > 0 ? '+' : '-'} at along ${a.toFixed(1)}`,
        });
      }
    }
    for (const end of [1, -1]) {
      for (let w = -d.hw; w <= d.hw + 1e-9; w += d.hw) {
        out.push({
          x: d.x + dirx * (d.hl + pad) * end + dirz * w,
          z: d.z + dirz * (d.hl + pad) * end - dirx * w,
          label: `${name} end ${end > 0 ? '+' : '-'} at across ${w.toFixed(1)}`,
        });
      }
    }
  }
  return out;
}

describe('the Palmreach jungle-pool walkway keeps no one', () => {
  it('is pointed at the jungle-pool platform and its stair', () => {
    // everything below reads REACH_DECKS by index; pin which records those are
    // so a reordered or retuned list cannot quietly aim this suite elsewhere
    expect({ x: PLATFORM.x, z: PLATFORM.z, hl: PLATFORM.hl, hw: PLATFORM.hw }).toEqual({
      x: -372,
      z: 1004,
      hl: 4.5,
      hw: 2.2,
    });
    expect(PLATFORM.ax2, 'the platform is the LEVEL deck (one anchor)').toBeUndefined();
    expect({ x: STAIR.x, z: STAIR.z, ax2: STAIR.ax2, az2: STAIR.az2 }).toEqual({
      x: -366.69,
      z: 998.99,
      ax2: -361,
      az2: 994,
    });
    // both decks hang off the same shore root, which is what makes their
    // planes meet at the junction; the bed shaping must never move it
    expect({ ax: PLATFORM.ax, az: PLATFORM.az }).toEqual({ ax: STAIR.ax, az: STAIR.az });
  });

  it('leaves both plank planes exactly where they were seated', () => {
    // The bed shaping under the walkway is deliberately confined BELOW the
    // deck anchors: the platform is freeboard-seated and the stair ramps from
    // that same plane up to the tangle-side bank. If a future terrain touch
    // lifts either anchor, both walkway surfaces move and every clearance
    // measured here goes stale.
    // the ground at both anchors, unchanged
    expect(terrain(PLATFORM.ax, PLATFORM.az)).toBeCloseTo(-4.05, 2);
    expect(terrain(-361, 994)).toBeCloseTo(2.64, 2);
    // the shore root sits below the freeboard line, so the platform is seated
    // on the freeboard, not on the shore: that is what makes its plane level
    expect(terrain(PLATFORM.ax, PLATFORM.az)).toBeLessThan(WATER_LEVEL + GALE_DECK_FREEBOARD);
    // and so the planes themselves are where every clearance here assumes
    expect(galeDeckSurfaceAt(PLATFORM, 0, terrain, WATER_LEVEL)).toBeCloseTo(-3.61, 2);
    expect(galeDeckSurfaceAt(STAIR, -STAIR.hl, terrain, WATER_LEVEL)).toBeCloseTo(-3.61, 2);
    expect(galeDeckSurfaceAt(STAIR, STAIR.hl, terrain, WATER_LEVEL)).toBeCloseTo(2.98, 2);
  });

  it('ties the platform into the sand a player can step back up', () => {
    // The plank plane is set by the deck freeboard, not the shore, so without
    // the sand tie-in the whole landward end is a knee-high plinth: a player
    // could walk off onto the strand and never step back on (a one-way deck).
    // One tick of run climbs RUN_SPEED * DT * MAX_CLIMB_SLOPE = 0.525yd.
    const oneTickClimb = 7 * (1 / 20) * PLAYER_MAX_CLIMB_SLOPE;
    const dirx = Math.sin(PLATFORM.rot);
    const dirz = Math.cos(PLATFORM.rot);
    for (let w = -PLATFORM.hw; w <= PLATFORM.hw + 1e-9; w += PLATFORM.hw / 2) {
      const ox = PLATFORM.x + dirx * (PLATFORM.hl + 0.3) + dirz * w;
      const oz = PLATFORM.z + dirz * (PLATFORM.hl + 0.3) - dirx * w;
      const ix = PLATFORM.x + dirx * (PLATFORM.hl - 0.05) + dirz * w;
      const iz = PLATFORM.z + dirz * (PLATFORM.hl - 0.05) - dirx * w;
      const lip = reachDeckSurface(ix, iz, terrain, WATER_LEVEL) - groundHeight(ox, oz, SEED);
      expect(lip, `landward end at across ${w.toFixed(1)}`).toBeLessThan(oneTickClimb);
    }
  });

  it('covers no ground the movement kernel calls unwalkable', () => {
    // The wedge's precondition, as data: a LEVEL plank plane over a terrain
    // cell steeper than the climb limit freezes a player outright (no
    // steering, and neither the downhill slide nor the wall standoff can see
    // past the flat planks). The 1-yd cells are exactly the cells the
    // memoized steepness view (terrainSteepnessAt) quantizes to.
    const over: string[] = [];
    for (const d of [PLATFORM, STAIR]) {
      const reach = Math.ceil(d.hl + d.hw) + 1;
      for (let cx = Math.floor(d.x - reach); cx <= Math.ceil(d.x + reach); cx++) {
        for (let cz = Math.floor(d.z - reach); cz <= Math.ceil(d.z + reach); cz++) {
          const steep = terrainSteepness(cx, cz, SEED);
          if (steep <= PLAYER_MAX_CLIMB_SLOPE) continue;
          // does any point that rounds into this cell stand on planks?
          let covered = false;
          for (let sx = cx - 0.5; sx <= cx + 0.5 + 1e-9 && !covered; sx += 0.25) {
            for (let sz = cz - 0.5; sz <= cz + 0.5 + 1e-9; sz += 0.25) {
              if (reachDeckSurface(sx, sz, terrain, WATER_LEVEL) !== -Infinity) {
                covered = true;
                break;
              }
            }
          }
          if (covered) over.push(`cell (${cx}, ${cz}) steepness ${steep.toFixed(3)}`);
        }
      }
    }
    expect(over).toEqual([]);
  });

  it('leaves no wedge anywhere over the walkway, the rim, or the beach', {
    timeout: 180_000,
  }, () => {
    const wedges = scanWedges(0.75);
    expect(wedges.map((w) => `(${w.x.toFixed(2)}, ${w.z.toFixed(2)})`)).toEqual([]);
  });

  it('frees the exact spot the player reported standing on', () => {
    // (-373, 1003) and the platform cells around it: the report's coordinates
    // land between scan samples, so pin the reported spot itself too.
    for (const spot of [
      { x: -373, z: 1003 },
      { x: -373, z: 1003.75 },
      { x: -373.75, z: 1004.5 },
      { x: -372.5, z: 1004 },
    ]) {
      expect(
        escapeDistance(spot.x, spot.z, 24, 400, ESCAPE_YARDS),
        `stuck at (${spot.x}, ${spot.z})`,
      ).toBeGreaterThan(ESCAPE_YARDS);
    }
  });

  it('walks the clifftop down the stair, over the platform and out to the beach', {
    timeout: 90_000,
  }, () => {
    const down = walkRoute(CLIFFTOP, DOWN_ROUTE);
    expect(down.completed, `stalled at (${down.stalledAt.x}, ${down.stalledAt.z})`).toBe(true);
  });

  it('walks the beach back up the stair to the clifftop', { timeout: 90_000 }, () => {
    const up = walkRoute(BEACH, UP_ROUTE);
    expect(up.completed, `stalled at (${up.stalledAt.x}, ${up.stalledAt.z})`).toBe(true);
  });

  it('lets a player who steps over any railing walk away from where they land', {
    timeout: 180_000,
  }, () => {
    const p = bodyForWalking();
    const trapped: string[] = [];
    for (const spot of edgeStepOffs()) {
      // land first: a step off an edge is a drop, so settle where it ends
      standAt(p, spot.x, spot.z);
      p.pos.y = Math.max(p.pos.y, groundHeight(spot.x, spot.z, SEED) + 0.05);
      for (let i = 0; i < 60; i++) {
        p.facing = 0;
        p.prevPos = { ...p.pos };
        stepPlayerMotion(deps, p, NO_INPUT);
      }
      const landed = { x: p.pos.x, z: p.pos.z };
      if (escapeDistance(landed.x, landed.z, 24, 400, ESCAPE_YARDS) <= ESCAPE_YARDS) {
        trapped.push(`${spot.label}: landed (${landed.x.toFixed(2)}, ${landed.z.toFixed(2)})`);
      }
    }
    expect(trapped).toEqual([]);
  });
});
