// Crowd-cost regression bound for the idle mob-AI aggro proximity scan
// (src/sim/mob/locomotion.ts). Each idle mob scans the player grid once per tick and
// increments aggroScanPlayerVisits (src/sim/mob/scan_counters.ts) exactly once per
// player it visits. The per-tick cost of a co-located camp is therefore a product:
//
//   per-tick visits = (scanning mobs) x (players within the grid radius).
//
// This suite pins that product for a scaled-down camp, and pins the load-shedding win
// of the narrowed grid radius: players seated in the former 25-yd window (strictly
// beyond the 20-yd grid radius) contribute ZERO visits, so a crowd that spreads just
// outside the ring stops costing the camp anything.
//
// Geometry (triangle inequality, so the bound holds for every wolf whatever the
// angles): the wolves sit within 1 yd of the camp center, the near players ride a
// 12-yd ring (11 to 13 yd from every wolf, inside the 20-yd grid radius), and the
// former-window players ride a 22.5-yd ring (21.5 to 23.5 yd from every wolf, outside
// 20 but inside the old 25). Each wolf is held in place (a large wanderTimer gates off
// the idle wander MOVE while the scan still runs every tick), so the camp geometry
// never drifts and the per-tick product is exact. Every player is made trivial
// (level 30 vs the level-5 wolves) so it is VISITED (the counter increment precedes the
// isTrivialTo skip) yet never aggroed, which keeps the camp scanning idle tick after
// tick. Placing the camp at FAR (outside the 360-yd world) keeps ambient world mobs out
// of the tally, so the visit totals are exact integer literals rather than lower bounds.

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';

type AnyEntity = ReturnType<typeof createMob> & Record<string, any>;
const seedOf = (sim: Sim): number => (sim as unknown as { cfg: { seed: number } }).cfg.seed;

// WORLD_SIZE is 360 (x spans [-180, 180]); (500, 500) sits well outside the playable
// world, so no world-spawned camp or mob is anywhere near it (asserted below as 0
// entities within 60 yd). The whole camp lands within ~23 yd of FAR, so an ambient mob
// beyond 60 yd of FAR is beyond even the former 25-yd query bound of every player here
// (let alone today's 20) and never counts one.
const FAR = { x: 500, z: 500 };

// Camp sizes. WOLVES x NEAR is the pinned crowd cost (7 x 6 = 42). FORMER players ride
// the former-window ring: under the old 25-yd radius they would have added FORMER x
// WOLVES = 35 visits (77 total); at the 20-yd radius they shed to zero.
const WOLVES = 7;
const NEAR = 6;
const FORMER = 5;

const WOLF_RING = 1; // wolves within 1 yd of the camp center
const NEAR_RING = 12; // near players: 11 to 13 yd from every wolf (inside grid radius 20)
const FORMER_RING = 22.5; // former-window players: 21.5 to 23.5 yd from every wolf
const TRIVIAL_LEVEL = 30; // >= wolf level (5) + 10, so isTrivialTo skips every player

// Even angular placement on a ring of the given radius around the camp center.
function ringOffset(i: number, count: number, radius: number): { dx: number; dz: number } {
  const theta = (2 * Math.PI * i) / count;
  return { dx: radius * Math.cos(theta), dz: radius * Math.sin(theta) };
}

// A level-5 forest wolf, idle and pinned. The idle branch still SCANS the player grid
// every tick (the visit count is exactly what we measure); the large wanderTimer only
// gates off the idle wander MOVE, so no wolf drifts and the per-tick geometry stays
// exact. The scan draws no rng, so the pinned camp is fully deterministic.
function pinnedIdleWolfAt(sim: Sim, id: number, dx: number, dz: number): AnyEntity {
  const x = FAR.x + dx;
  const z = FAR.z + dz;
  const mob = createMob(id, MOBS.forest_wolf, 5, {
    x,
    y: terrainHeight(x, z, seedOf(sim)),
    z,
  }) as AnyEntity;
  mob.aiState = 'idle';
  mob.wanderTimer = 1_000_000;
  (sim as unknown as { addEntity: (e: Entity) => void }).addEntity(mob);
  return mob;
}

// Add a warrior and teleport it to (FAR.x + dx, FAR.z + dz), returning its Entity.
function addPlayerAt(sim: Sim, name: string, dx: number, dz: number): Entity {
  const pid = sim.addPlayer('warrior', name);
  const e = (sim as unknown as { entities: Map<number, Entity> }).entities.get(pid) as AnyEntity;
  e.pos.x = FAR.x + dx;
  e.pos.z = FAR.z + dz;
  e.pos.y = terrainHeight(e.pos.x, e.pos.z, seedOf(sim));
  e.prevPos = { ...e.pos };
  return e;
}

// Same, then raise the player well above the wolves so isTrivialTo skips it. It is
// still visited (the counter increments first) but never aggroed, so the wolves keep
// scanning idle.
function addTrivialPlayerAt(sim: Sim, name: string, dx: number, dz: number): void {
  const e = addPlayerAt(sim, name, dx, dz);
  sim.setPlayerLevel(TRIVIAL_LEVEL, e.id);
}

function refreshPlayerGrid(sim: Sim): void {
  const s = sim as unknown as {
    playerGrid: { refresh: (it: Iterable<Entity>) => void };
    playerEntities: () => Iterable<Entity>;
  };
  s.playerGrid.refresh(s.playerEntities());
}

function noPlayerSim(): Sim {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

// Place WOLVES pinned idle wolves clustered within WOLF_RING of the camp center.
function placeIdleCamp(sim: Sim): AnyEntity[] {
  const wolves: AnyEntity[] = [];
  for (let i = 0; i < WOLVES; i++) {
    const { dx, dz } = ringOffset(i, WOLVES, WOLF_RING);
    wolves.push(pinnedIdleWolfAt(sim, 950001 + i, dx, dz));
  }
  return wolves;
}

// Place NEAR trivial players on the 12-yd ring (inside the grid radius of every wolf).
function placeNearPlayers(sim: Sim): void {
  for (let j = 0; j < NEAR; j++) {
    const { dx, dz } = ringOffset(j, NEAR, NEAR_RING);
    addTrivialPlayerAt(sim, `Near${j}`, dx, dz);
  }
}

describe('mob crowd cost: the FAR camp is clear of world spawns', () => {
  it('has no world entity within 60 yd of the camp, so the visit totals are exact', () => {
    const sim = noPlayerSim();
    let near = 0;
    for (const e of (sim as unknown as { entities: Map<number, Entity> }).entities.values()) {
      const dx = e.pos.x - FAR.x;
      const dz = e.pos.z - FAR.z;
      if (dx * dx + dz * dz <= 60 * 60) near++;
    }
    expect(near).toBe(0);
  });
});

describe('mob crowd cost: per-tick aggro-scan visits equal the grid product', () => {
  it('a camp of 7 idle wolves and 6 near players costs exactly 42 visits every tick, with no growth', () => {
    const sim = noPlayerSim();
    const wolves = placeIdleCamp(sim);
    placeNearPlayers(sim);
    refreshPlayerGrid(sim);

    // per-tick visits = 7 scanning wolves x 6 near players = 42. The counter resets at
    // the top of tick(), so each post-tick read is that tick's own tally: a value that
    // grew across ticks (double counting, carry-over) or shrank (a player wrongly
    // dropped) would redden here. A pure idle camp runs no threat walks, so
    // threatEntryVisits stays 0.
    for (let t = 0; t < 10; t++) {
      sim.tick();
      expect(sim.mobScanCounters.aggroScanPlayerVisits).toBe(42);
      expect(sim.mobScanCounters.threatEntryVisits).toBe(0);
    }

    // The bound is honest only if the wolves really stayed idle (a stray aggro would end
    // the scan and drop the count).
    for (const w of wolves) expect(w.aiState).toBe('idle');
  });

  it('players seated in the former 25-yd window add zero visits at the 20-yd grid radius', () => {
    const sim = noPlayerSim();
    const wolves = placeIdleCamp(sim);
    placeNearPlayers(sim);
    // FORMER extra players on the 22.5-yd ring: 21.5 to 23.5 yd from every wolf, so
    // strictly outside the 20-yd grid radius (never visited) but inside the old 25-yd
    // window (which would have counted all FORMER x WOLVES = 35 of them, 77 total). At
    // grid radius 20 they shed to zero and the crowd cost stays the 42-visit product.
    for (let k = 0; k < FORMER; k++) {
      const { dx, dz } = ringOffset(k, FORMER, FORMER_RING);
      addTrivialPlayerAt(sim, `Former${k}`, dx, dz);
    }
    refreshPlayerGrid(sim);

    for (let t = 0; t < 10; t++) {
      sim.tick();
      expect(sim.mobScanCounters.aggroScanPlayerVisits).toBe(42);
      expect(sim.mobScanCounters.threatEntryVisits).toBe(0);
    }

    for (const w of wolves) expect(w.aiState).toBe('idle');
  });

  it('a mixed camp: engaged mobs stop paying scan cost, so the product covers idle mobs only', () => {
    const sim = noPlayerSim();
    // Camp A at FAR: 4 pinned idle wolves + 3 trivial players on the 12-yd ring, so the
    // idle product is 4 x 3 = 12 visits/tick. Camp B, 60 yd east (still deep outside
    // the world, guarded below): 3 pinned wolves + one level-1 player 10 yd from them,
    // inside their effective radius of 16, so camp B ENGAGES on the first tick (the
    // first wolf detects and its social pull, radius 5, drags the other two). The two
    // camps are disjoint: A's players sit 48+ yd from every B wolf, B's player 68+ yd
    // from every A wolf, and B's wolves close on their target far too slowly to reach
    // melee (or camp A) within the window.
    const CAMP_B = 60;
    const wolvesA: AnyEntity[] = [];
    for (let i = 0; i < 4; i++) {
      const { dx, dz } = ringOffset(i, 4, WOLF_RING);
      wolvesA.push(pinnedIdleWolfAt(sim, 951001 + i, dx, dz));
    }
    const wolvesB: AnyEntity[] = [];
    for (let i = 0; i < 3; i++) {
      const { dx, dz } = ringOffset(i, 3, WOLF_RING);
      wolvesB.push(pinnedIdleWolfAt(sim, 952001 + i, CAMP_B + dx, dz));
    }
    for (let j = 0; j < 3; j++) {
      const { dx, dz } = ringOffset(j, 3, NEAR_RING);
      addTrivialPlayerAt(sim, `MixNear${j}`, dx, dz);
    }
    const bait = addPlayerAt(sim, 'MixBait', CAMP_B + 10, 0);
    // Nothing else lives near either camp (the world sits 450+ yd away), so both
    // products are exact.
    let near = 0;
    for (const e of (sim as unknown as { entities: Map<number, Entity> }).entities.values()) {
      const dx = e.pos.x - FAR.x;
      const dz = e.pos.z - FAR.z;
      if (e.id < 951001 && e.kind !== 'player' && dx * dx + dz * dz <= 130 * 130) near++;
    }
    expect(near).toBe(0);
    refreshPlayerGrid(sim);

    // Tick 1: all 7 wolves still start idle. A wolves visit 4 x 3 = 12; the FIRST B
    // wolf visits the bait (1), detects it (d = 10 < 16), and its social pull flips
    // the other two B wolves to chase before their own updates run, so they never
    // scan: 13 visits total, exactly once.
    sim.tick();
    expect(sim.mobScanCounters.aggroScanPlayerVisits).toBe(13);

    // Steady state: only camp A still pays scan cost (4 x 3 = 12); the engaged camp
    // B wolves pay threat-walk cost instead (3 wolves x 1 hate-table entry, the bait
    // seeded by aggroMob, walked once per engaged tick).
    for (let t = 0; t < 5; t++) {
      sim.tick();
      expect(sim.mobScanCounters.aggroScanPlayerVisits).toBe(12);
      expect(sim.mobScanCounters.threatEntryVisits).toBe(3);
    }

    for (const w of wolvesA) expect(w.aiState).toBe('idle');
    for (const w of wolvesB) {
      expect(w.aiState).toBe('chase');
      expect(w.aggroTargetId).toBe(bait.id);
    }
  });
});
