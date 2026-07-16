// Direct unit tests for the mob-AI scan observability counters
// (src/sim/mob/scan_counters.ts), the two hot paths that feed them
// (src/sim/mob/locomotion.ts idle aggro scan and src/sim/mob/targeting.ts threat
// walks), and their per-tick reset + observer purity on the Sim coordinator.
//
// The counters attribute mob.update cost without touching gameplay: every literal
// here is hand-computed from the real loop bodies, so a test reddens if an
// increment is removed or moved, if the per-tick reset moves, or if reading the
// getter ever perturbs the deterministic world.

import { describe, expect, it } from 'vitest';
import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { updateMob } from '../src/sim/mob/locomotion';
import { createMobScanCounters } from '../src/sim/mob/scan_counters';
import { highestThreatTarget, retargetMob, updateMobTarget } from '../src/sim/mob/targeting';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import { STEALTH_DETECTION_MAX_MULT, stealthDetectionMultiplier } from '../src/sim/threat';
import { type Entity, NYTHRAXIS_BOSS_ID } from '../src/sim/types';
import { terrainHeight } from '../src/sim/world';
import { canonical, sampleEntity, samplePlayerMeta } from './parity/trace';

type AnyEntity = ReturnType<typeof createMob> & Record<string, any>;
const ctxOf = (sim: Sim): SimContext => (sim as unknown as { ctx: SimContext }).ctx;
const seedOf = (sim: Sim): number => (sim as unknown as { cfg: { seed: number } }).cfg.seed;

// WORLD_SIZE is 360 (x spans [-180, 180]; src/sim/data.ts), so (500, 500) sits well
// outside the playable world: there are no world-spawned camps or mobs anywhere near
// it (asserted below as 0 entities within 60 units). Running the aggro scan there
// isolates the counter to exactly the players this test places, so the visit totals
// are exact integer literals rather than "at least".
const FAR = { x: 500, z: 500 };

function noPlayerSim(): Sim {
  return new Sim({ seed: 42, playerClass: 'warrior', noPlayer: true });
}

// Add a fresh warrior and teleport it to (FAR.x + dx, FAR.z + dz). Optionally mark it
// dead: the aggro-scan increment runs BEFORE the callback's dead check, so a dead
// player in radius still counts as a grid visit.
function addPlayerAt(sim: Sim, name: string, dx: number, dz: number, dead = false): Entity {
  const pid = sim.addPlayer('warrior', name);
  const e = (sim as unknown as { entities: Map<number, Entity> }).entities.get(pid) as AnyEntity;
  e.pos.x = FAR.x + dx;
  e.pos.z = FAR.z + dz;
  e.pos.y = terrainHeight(e.pos.x, e.pos.z, seedOf(sim));
  e.prevPos = { ...e.pos };
  if (dead) e.dead = true;
  return e;
}

function idleForestWolf(sim: Sim, id: number): AnyEntity {
  const mob = createMob(id, MOBS.forest_wolf, 5, {
    x: FAR.x,
    y: terrainHeight(FAR.x, FAR.z, seedOf(sim)),
    z: FAR.z,
  }) as AnyEntity;
  mob.aiState = 'idle';
  (sim as unknown as { addEntity: (e: Entity) => void }).addEntity(mob);
  return mob;
}

function refreshPlayerGrid(sim: Sim): void {
  const s = sim as unknown as {
    playerGrid: { refresh: (it: Iterable<Entity>) => void };
    playerEntities: () => Iterable<Entity>;
  };
  s.playerGrid.refresh(s.playerEntities());
}

// ---- the minimal-fake targeting harness (mirrors tests/mob_targeting.test.ts) -----

// Minimal Entity carrying only the fields the targeting functions touch.
function ent(id: number, over: Partial<Entity> = {}): Entity {
  return {
    id,
    dead: false,
    pos: { x: 0, y: 0, z: 0 },
    level: 1,
    templateId: 'forest_wolf',
    ownerId: null,
    scale: 1,
    aiState: 'idle',
    inCombat: false,
    despawnTimer: undefined,
    aggroTargetId: null,
    forcedTargetId: null,
    forcedTargetTimer: 0,
    threat: new Map<number, number>(),
    ...over,
  } as unknown as Entity;
}

// Fake seam: the targeting module reads `entities` and the mob-scan counters, and
// calls the two Nythraxis helpers. A fresh counter object per ctx so each call's
// tally is read in isolation.
function fakeCtx(
  entities: Map<number, Entity>,
  opts: { fallback?: Entity | null; despawn?: boolean } = {},
): SimContext {
  return {
    entities,
    mobScanCounters: createMobScanCounters(),
    nythraxisAddFallbackTarget: () => opts.fallback ?? null,
    scheduleNythraxisAddDespawnIfBossReset: () => opts.despawn ?? false,
  } as unknown as SimContext;
}

describe('mob scan counters: (FAR) spot is clear of world spawns', () => {
  it('has no world entity within 60 units, so the aggro-scan totals are exact', () => {
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

describe('mob scan counters: aggro-scan player visits (updateMob idle branch)', () => {
  it('counts one visit per in-radius player and excludes players beyond the grid radius', () => {
    const sim = noPlayerSim();
    // Two players within the radius-20 grid query (distances 10 and exactly 20: the query
    // keeps d2 <= r2, so the 20-unit player on the boundary IS visited), one just past the
    // boundary (21: with On20 this closes the query radius to exactly 20, so a drifted
    // constant would red here), one in the former 25-yd window (22, now excluded), and
    // two farther out (30, 45) that must not be counted.
    addPlayerAt(sim, 'In10', 10, 0);
    addPlayerAt(sim, 'On20', 0, 20);
    addPlayerAt(sim, 'Out21', 21, 0);
    addPlayerAt(sim, 'Out22', 0, 22);
    addPlayerAt(sim, 'Out30', 30, 0);
    addPlayerAt(sim, 'Out45', 0, 45);
    const mob = idleForestWolf(sim, 900101);
    refreshPlayerGrid(sim);

    // Direct updateMob call (no tick) so nothing resets the counter mid-test; a fresh
    // Sim starts the counter at 0, so this reads exactly this scan's tally.
    updateMob(ctxOf(sim), mob);

    expect(sim.mobScanCounters.aggroScanPlayerVisits).toBe(2);
  });

  it('detects strictly (d < radius): a live player at exactly the effective radius stays safe', () => {
    const sim = noPlayerSim();
    // A level-5 forest wolf vs a level-1 player has effective aggro radius
    // max(4, min(20, 10 + (5 - 1) * 1.5)) = 16 exactly (aggroRadius 10 in
    // src/sim/content/zone1.ts; pinned below so the 16 derivation reddens if the
    // content value drifts). A live, non-trivial player at exactly 16 is inside the
    // grid query (visited) but the detection check is strict, so the wolf must stay
    // idle: this pins the strict inequality on the general branch (the Nythraxis case
    // below pins it on the boss branch).
    expect(MOBS.forest_wolf.aggroRadius).toBe(10);
    addPlayerAt(sim, 'On16', 16, 0);
    const mob = idleForestWolf(sim, 900103);
    refreshPlayerGrid(sim);

    updateMob(ctxOf(sim), mob);

    expect(sim.mobScanCounters.aggroScanPlayerVisits).toBe(1);
    expect(mob.aiState).toBe('idle');
    expect(mob.aggroTargetId).toBe(null);
  });

  it('still detects in the outer band: a player between 16 and 20 aggros a level-advantaged wolf', () => {
    const sim = noPlayerSim();
    // Positive control for the narrowed query: every other aggro assertion in the
    // three suites is negative (stays idle), so a regression that clamped detection
    // BELOW 20 (say to 16) would pass them all. A level-8 wolf vs a level-1 player has
    // effective radius max(4, min(20, 10 + (8 - 1) * 1.5)) = 20 exactly, so a player
    // at 18 (inside the former dead band's inner edge, outside the wolf-vs-level-1
    // radius of 16) must be visited AND detected: the wolf leaves idle and targets it.
    const player = addPlayerAt(sim, 'In18', 18, 0);
    const mob = createMob(900104, MOBS.forest_wolf, 8, {
      x: FAR.x,
      y: terrainHeight(FAR.x, FAR.z, seedOf(sim)),
      z: FAR.z,
    }) as AnyEntity;
    mob.aiState = 'idle';
    (sim as unknown as { addEntity: (e: Entity) => void }).addEntity(mob);
    refreshPlayerGrid(sim);

    updateMob(ctxOf(sim), mob);

    expect(sim.mobScanCounters.aggroScanPlayerVisits).toBe(1);
    expect(mob.aiState).toBe('chase');
    expect(mob.aggroTargetId).toBe(player.id);
  });

  it('counts a dead player in radius because the increment precedes the dead check', () => {
    const sim = noPlayerSim();
    // One dead and one live player, both inside radius 20. The callback increments the
    // counter as its FIRST statement, before `if (e.dead) return`, so both count.
    addPlayerAt(sim, 'DeadIn', 12, 0, true);
    addPlayerAt(sim, 'LiveIn', 0, 18);
    const mob = idleForestWolf(sim, 900102);
    refreshPlayerGrid(sim);

    updateMob(ctxOf(sim), mob);

    expect(sim.mobScanCounters.aggroScanPlayerVisits).toBe(2);
  });

  it('counts visits in the Nythraxis idle scan too (the second scan callback)', () => {
    // updateMob has TWO idle aggro-scan callbacks: the general branch (above) and the
    // Nythraxis boss branch. Both increment aggroScanPlayerVisits, so cover both.
    const sim = noPlayerSim();
    // The Nythraxis idle branch recenters the boss on its spawnPos before scanning, and
    // createMob seeds spawnPos from the passed position, so the boss scans from FAR. The
    // boss's effective aggro radius clamps to 20 and the detection check is strict
    // (d < radius), so a live player at exactly 20 is visited but never detected. One
    // live player on the radius-20 boundary (visited, not detected) and one dead player
    // inside it (visited because the counter increments before the dead check, never
    // detected): two visits, boss stays idle. One live player at 22 (inside the former
    // 25-yd window but now beyond the grid radius) proves the narrowing by not being
    // visited, and one at 40 is far outside and also not visited.
    addPlayerAt(sim, 'On20', 20, 0);
    addPlayerAt(sim, 'DeadIn15', 0, 15, true);
    addPlayerAt(sim, 'Out22', 0, 22);
    addPlayerAt(sim, 'Out40', 40, 0);
    const boss = createMob(900501, MOBS[NYTHRAXIS_BOSS_ID], 20, {
      x: FAR.x,
      y: terrainHeight(FAR.x, FAR.z, seedOf(sim)),
      z: FAR.z,
    }) as AnyEntity;
    // A freshly created boss has no `nythraxis` encounter state, so updateMob skips the
    // encounter driver and reaches the idle-branch scan.
    boss.aiState = 'idle';
    (sim as unknown as { addEntity: (e: Entity) => void }).addEntity(boss);
    refreshPlayerGrid(sim);

    updateMob(ctxOf(sim), boss);

    expect(sim.mobScanCounters.aggroScanPlayerVisits).toBe(2);
    expect(boss.aiState).toBe('idle'); // the visited players sit on the boundary or are dead
  });

  it('pins each Nythraxis-scan candidate in isolation, so a total cannot hide a swap', () => {
    // The combined case above pins only the TOTAL (2), which two compensating boundary
    // bugs could fake (say, dropping On20 while visiting Out22). A fresh sim with a solo
    // player pins each candidate's individual contribution decisively.
    const cases: [string, number, number, boolean, number][] = [
      ['On20', 20, 0, false, 1],
      ['DeadOn20', 0, 20, true, 1], // boundary AND dead: visited (increment precedes both checks)
      ['DeadIn15', 0, 15, true, 1],
      ['Out21', 21, 0, false, 0],
      ['Out22', 0, 22, false, 0],
      ['Out40', 40, 0, false, 0],
    ];
    for (const [name, dx, dz, dead, visits] of cases) {
      const sim = noPlayerSim();
      addPlayerAt(sim, name, dx, dz, dead);
      const boss = createMob(900502, MOBS[NYTHRAXIS_BOSS_ID], 20, {
        x: FAR.x,
        y: terrainHeight(FAR.x, FAR.z, seedOf(sim)),
        z: FAR.z,
      }) as AnyEntity;
      boss.aiState = 'idle';
      (sim as unknown as { addEntity: (e: Entity) => void }).addEntity(boss);
      refreshPlayerGrid(sim);

      updateMob(ctxOf(sim), boss);

      expect(sim.mobScanCounters.aggroScanPlayerVisits, name).toBe(visits);
      expect(boss.aiState, name).toBe('idle');
    }
  });
});

describe('mob scan counters: threat-entry visits (targeting loops)', () => {
  it('highestThreatTarget visits every table entry exactly once', () => {
    const ctx = fakeCtx(
      new Map([
        [1, ent(1)],
        [2, ent(2)],
      ]),
    );
    const mob = ent(10, {
      threat: new Map([
        [1, 70],
        [2, 30],
      ]),
    });
    highestThreatTarget(ctx, mob);
    // Two living entries, none pruned: two visits.
    expect(ctx.mobScanCounters.threatEntryVisits).toBe(2);
  });

  it('updateMobTarget with a live current target visits its own pull-over loop entries', () => {
    const ctx = fakeCtx(
      new Map([
        [1, ent(1)],
        [2, ent(2)],
        [3, ent(3)],
        [4, ent(4)],
      ]),
    );
    // Current target id 1 holds the most threat, so no pull-over fires; the loop still
    // visits ALL four entries (the increment precedes the `id === cur.id || t <= bestT`
    // continue), so the current target counts too. Only the own loop runs here (a live
    // current target skips the highestThreatTarget delegate).
    const mob = ent(10, {
      aggroTargetId: 1,
      threat: new Map([
        [1, 100],
        [2, 50],
        [3, 30],
        [4, 20],
      ]),
    });
    updateMobTarget(ctx, mob);
    expect(ctx.mobScanCounters.threatEntryVisits).toBe(4);
    expect(mob.aggroTargetId).toBe(1); // held (proves the own pull-over loop ran)
  });

  it('updateMobTarget with no current target delegates to highestThreatTarget', () => {
    const ctx = fakeCtx(
      new Map([
        [1, ent(1)],
        [2, ent(2)],
        [3, ent(3)],
      ]),
    );
    // aggroTargetId null: the no-target branch calls highestThreatTarget and returns
    // BEFORE the own pull-over loop, so the three visits come solely from the delegate
    // (own loop contributes 0; delegate contributes 3; sum 3).
    const mob = ent(10, {
      aggroTargetId: null,
      threat: new Map([
        [1, 100],
        [2, 50],
        [3, 30],
      ]),
    });
    updateMobTarget(ctx, mob);
    expect(ctx.mobScanCounters.threatEntryVisits).toBe(3);
    expect(mob.aggroTargetId).toBe(1); // delegate picked the highest (proves it ran)
  });

  it('retargetMob delegates to highestThreatTarget', () => {
    const ctx = fakeCtx(
      new Map([
        [1, ent(1)],
        [3, ent(3)],
      ]),
    );
    const mob = ent(10, {
      aiState: 'attack',
      threat: new Map([
        [1, 100],
        [3, 140],
      ]),
    });
    retargetMob(ctx, mob);
    // retargetMob's only threat walk is the highestThreatTarget delegate: two entries.
    expect(ctx.mobScanCounters.threatEntryVisits).toBe(2);
    expect(mob.aggroTargetId).toBe(3);
  });
});

describe('mob scan counters: per-tick reset', () => {
  it('zeroes at the top of each tick so a read sees only that tick tally', () => {
    const sim = noPlayerSim();
    // One player at distance 20: on the radius-20 grid boundary (one visit, the query
    // keeps d2 <= r2) but outside the mob's effective aggro radius (16 for a level-5 wolf
    // vs a level-1 player), so the mob stays idle and keeps scanning tick after tick.
    const player = addPlayerAt(sim, 'Solo', 0, 20);
    idleForestWolf(sim, 900201);
    refreshPlayerGrid(sim);

    sim.tick();
    expect(sim.mobScanCounters.aggroScanPlayerVisits).toBe(1);

    // Move the player far out of range and refresh the grid, then tick again. Without
    // the reset at the top of tick() the counter would carry the previous 1 forward;
    // with it, this tick's own tally (0 visits) is all that remains.
    player.pos.z = FAR.z + 5000;
    player.pos.y = terrainHeight(player.pos.x, player.pos.z, seedOf(sim));
    (player as AnyEntity).prevPos = { ...player.pos };
    refreshPlayerGrid(sim);

    sim.tick();
    expect(sim.mobScanCounters.aggroScanPlayerVisits).toBe(0);
  });
});

describe('idle-scan narrowing premise: detection modifiers are shrink-only', () => {
  // The narrowed grid query (MAX_AGGRO_RADIUS) is behavior-identical ONLY while every
  // post-clamp detection modifier stays <= 1: the general idle branch clamps the base
  // radius to 20 BEFORE applying delveDetectMult and stealthDetectionRadius, with no
  // re-clamp after, so a future boosting modifier (mult > 1) would be silently capped
  // by the query where the old 25-yd query would have honored it out to 25. These pins
  // red the moment that premise breaks so the query bound gets revisited deliberately.
  // (delveDetectMult's full current affix surface, 1 and candleblind 0.65, is pinned
  // by literals in tests/delves.test.ts.)
  it('the stealth detection multiplier is capped at exactly 1, even at extreme level advantage', () => {
    expect(STEALTH_DETECTION_MAX_MULT).toBe(1);
    // Clamp regime: raw = 0.25 + (30 - 1) * 0.08 = 2.57, clamped to the max mult.
    expect(stealthDetectionMultiplier(30, 1)).toBe(1);
    expect(stealthDetectionMultiplier(60, 1)).toBe(1);
  });
});

describe('mob scan counters: reading them is a pure observer', () => {
  // Two Sims built with identical config and identical scripted input; run 1 reads the
  // mobScanCounters getter every tick and run 2 never touches it. The getter returns a
  // live readonly view, draws no rng and mutates nothing, so the two deterministic
  // worlds must end bit-for-bit identical. Reuses the parity trace samplers so the
  // comparison covers every gameplay field, not a hand-picked subset.
  const WOLF_ID = 900301;
  const buildRun = (): Sim => {
    const sim = new Sim({ seed: 42, playerClass: 'warrior', autoEquip: true });
    const player = sim.player;
    const pos = {
      x: player.pos.x + 6,
      z: player.pos.z,
      y: terrainHeight(player.pos.x + 6, player.pos.z, seedOf(sim)),
    };
    const wolf = createMob(WOLF_ID, MOBS.forest_wolf, 5, pos) as AnyEntity;
    wolf.aiState = 'idle';
    (sim as unknown as { addEntity: (e: Entity) => void }).addEntity(wolf);
    return sim;
  };

  const worldState = (sim: Sim): unknown => {
    const s = sim as unknown as {
      entities: Map<number, Entity>;
      players: Map<number, unknown>;
      time: number;
      tickCount: number;
      nextId: number;
      rng: { s: number };
    };
    const entities = [...s.entities.values()]
      .sort((a, b) => a.id - b.id)
      .map((e) => sampleEntity(e));
    const players = [...s.players.values()].map((m) => samplePlayerMeta(m as never));
    // The rng's internal mulberry32 state is the tightest net: an extra draw caused
    // by the observer would fork it even if the sampled world state happened to
    // coincide.
    return canonical({
      time: s.time,
      tickCount: s.tickCount,
      nextId: s.nextId,
      rngState: s.rng.s,
      entities,
      players,
    });
  };

  it('two identical runs agree bit for bit whether or not the counters are read', () => {
    const observed = buildRun();
    let observerSum = 0;
    for (let i = 0; i < 50; i++) {
      observed.tick();
      // Read the public getter every tick (the incident-capture host does exactly this).
      const c = observed.mobScanCounters;
      observerSum += c.aggroScanPlayerVisits + c.threatEntryVisits;
    }

    const untouched = buildRun();
    for (let i = 0; i < 50; i++) untouched.tick();

    // The scenario really exercises the counters (a wolf aggros and fights the player),
    // so the observer read is meaningful rather than reading a perpetual zero.
    expect(observerSum).toBeGreaterThan(0);
    // ...and reading them left the world identical to the run that never looked.
    expect(worldState(observed)).toEqual(worldState(untouched));
  });
});
