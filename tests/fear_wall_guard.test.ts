import { describe, expect, it } from 'vitest';
import { moverHeight, resolvePosition } from '../src/sim/colliders';
import {
  FEAR_WALL_LOOKAHEAD,
  fearWallOpenDistance,
  steerFearFromWalls,
} from '../src/sim/combat/fear_steering';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { PLAYER_BODY_RADIUS } from '../src/sim/pathfind';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { type Aura, dist2d, type Entity } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

// Fear runs a player on one FIXED heading. If that heading points at a wall, they
// used to grind into it (and, players reported, sometimes end up inside). The
// guard (combat/fear_steering.ts) steers the flee heading to the most open
// direction when a wall is within FEAR_WALL_LOOKAHEAD yards, so a feared player
// rounds walls instead of pinning on them. Player-only and rng-free, so feared
// mobs and the parity draw order are untouched.
//
// Fixture: the full-height building at (17.5, -5.5) spans x[11,24] z[-10,-1]; a
// player 2yd south of its near (z = -10) face on heading 0 (+z) runs straight
// into it, while heading PI (-z) is open ground to the south.
const R = PLAYER_BODY_RADIUS;
const START = { x: 11.0, z: -12.0 };
const INTO_WALL = 0; // +z, into the building 2yd ahead
const AWAY = Math.PI; // -z, open ground to the south

function fearAura(angle: number): Aura {
  return {
    id: 'fear_incap',
    name: 'Fear',
    kind: 'incapacitate',
    remaining: 60,
    duration: 60,
    value: angle, // the flee heading updateFearMovement reads
    sourceId: 0,
    school: 'physical',
  };
}

function fearedAt(x: number, z: number, angle: number): { sim: Sim; aura: Aura } {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', autoEquip: true });
  sim.setPlayerLevel(20);
  const p = sim.player;
  p.pos = { x, y: groundHeight(x, z, WORLD_SEED), z };
  p.prevPos = { ...p.pos };
  sim.rebucket(p);
  const aura = fearAura(angle);
  p.auras.push(aura);
  return { sim, aura };
}

// Mover-aware "is the player inside a full-height wall" oracle: resolvePosition
// with the player's own mover height (so a low prop it steps over is not counted).
function insideWall(p: Entity): boolean {
  const m = moverHeight({ pos: { y: p.pos.y }, onGround: p.onGround });
  const r = resolvePosition(WORLD_SEED, p.pos.x, p.pos.z, R, false, undefined, m, 0);
  return Math.hypot(r.x - p.pos.x, r.z - p.pos.z) > 0.05;
}

describe('fear_steering (unit)', () => {
  it('fixture: a wall is within range on INTO_WALL, open on AWAY, clean start', () => {
    const { sim } = fearedAt(START.x, START.z, INTO_WALL);
    expect(insideWall(sim.player)).toBe(false);
    expect(fearWallOpenDistance(sim.ctx, sim.player, INTO_WALL)).toBeLessThan(FEAR_WALL_LOOKAHEAD);
    expect(fearWallOpenDistance(sim.ctx, sim.player, AWAY)).toBe(FEAR_WALL_LOOKAHEAD);
  });

  it('steers to a more open heading when a wall is ahead', () => {
    const { sim } = fearedAt(START.x, START.z, INTO_WALL);
    const openInto = fearWallOpenDistance(sim.ctx, sim.player, INTO_WALL);
    const chosen = steerFearFromWalls(sim.ctx, sim.player, INTO_WALL);
    expect(chosen).not.toBe(INTO_WALL);
    expect(fearWallOpenDistance(sim.ctx, sim.player, chosen)).toBeGreaterThan(openInto);
  });

  it('leaves an already-open heading alone', () => {
    const { sim } = fearedAt(START.x, START.z, AWAY);
    expect(steerFearFromWalls(sim.ctx, sim.player, AWAY)).toBe(AWAY);
  });

  it('keeps the heading in a fully enclosed pocket (no-jitter fallback)', () => {
    // A ctx whose every probe reports blocked: no fan heading is more open than
    // the straight one, so the original heading is kept.
    const sealed = {
      resolveMovePoint: (x: number, z: number) => ({ x: x + 99, z: z + 99 }),
    } as unknown as SimContext;
    const e = { pos: { x: 0, y: 0, z: 0 }, onGround: true } as unknown as Entity;
    expect(steerFearFromWalls(sealed, e, 0.7)).toBe(0.7);
  });
});

describe('fear steering (integration through the tick)', () => {
  it('redirects a feared player who faces a wall', () => {
    const { sim, aura } = fearedAt(START.x, START.z, INTO_WALL);
    sim.tick();
    expect(aura.value).not.toBe(INTO_WALL); // updateFearMovement applied and remembered the turn
  });

  it('leaves an already-open flee heading (normal fear preserved)', () => {
    const { sim, aura } = fearedAt(START.x, START.z, AWAY);
    sim.tick();
    expect(aura.value).toBe(AWAY);
  });

  it('does NOT steer a feared MOB (player-only guard keeps mob movement and parity)', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', autoEquip: true }) as Sim & {
      addEntity(e: Entity): void;
      nextId: number;
    };
    sim.setPlayerLevel(20);
    const mob = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
      x: START.x,
      y: groundHeight(START.x, START.z, WORLD_SEED),
      z: START.z,
    });
    mob.hostile = true;
    mob.moveSpeed = 5; // so the fear actually moves it: keeps the test non-vacuous
    sim.addEntity(mob);
    const from = { x: mob.pos.x, y: mob.pos.y, z: mob.pos.z };
    mob.auras.push(fearAura(INTO_WALL)); // feared straight into the same building
    for (let i = 0; i < 5; i++) sim.tick();
    const aura = mob.auras.find((a) => a.id === 'fear_incap');
    expect(aura?.value).toBe(INTO_WALL); // mob keeps its fixed heading; the guard skips mobs
    expect(dist2d(mob.pos, from)).toBeGreaterThan(0); // updateFearMovement DID run (not vacuous)
  });

  it('rounds the building without ever ending up inside a wall', () => {
    const { sim } = fearedAt(START.x, START.z, INTO_WALL);
    const p = sim.player;
    const from = { x: p.pos.x, y: p.pos.y, z: p.pos.z };
    let everInside = false;
    for (let i = 0; i < 20 * 4; i++) {
      sim.tick();
      if (insideWall(p)) everInside = true;
    }
    expect(everInside).toBe(false); // steered around it, never clipped inside (mover-aware)
    expect(dist2d(p.pos, from)).toBeGreaterThan(8); // fled a real distance, not pinned on the face
  });

  it('/dev fear applies a fear along the player facing (solo test hook)', () => {
    const sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      autoEquip: true,
      devCommands: true,
    });
    sim.setPlayerLevel(20);
    sim.player.facing = 1.2;
    sim.chat('/dev fear');
    const aura = sim.player.auras.find((a) => a.id === 'fear_incap');
    expect(aura).toBeTruthy();
    expect(aura?.kind).toBe('incapacitate');
    expect(aura?.value).toBe(1.2); // flee heading = the player's facing
  });
});
