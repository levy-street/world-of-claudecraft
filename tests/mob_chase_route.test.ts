// A mob's way round a wall (src/sim/mob/chase_route.ts, mob/route_search.ts):
// in a real claimed HEROIC Hollow Crypt an Ossuary Warrior whose target stands
// across the Undercroft Grille's curtain wall walks through the gate instead
// of standing against the wall until the instance hold phases it through. With
// the gate shut there is no way round, and the stall, the hold and the phase
// rule exactly as before.
//
// The second half pins what keeps the search affordable on the server's tick
// and what keeps it from being farmed: the node cap, the tick budget, the
// throttle that outlives the path, the backoff on failure, the pack's shared
// "no route", and the watchdog on a route that stops making headway. Costs are
// read off the sim's own per-tick tallies (Sim.mobScanCounters), never a clock.

import { describe, expect, it, vi } from 'vitest';
import { isBlocked } from '../src/sim/colliders';
import { DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { DAWNHOLD, DAWNHOLD_GATES } from '../src/sim/dawnhold_layout';
import { createMob } from '../src/sim/entity';
import {
  applyDungeonMobTuning,
  mobLevelForDungeonDifficulty,
  mobTemplateForDungeonDifficulty,
} from '../src/sim/instances/difficulty';
import { claimedInstanceAt, enterDungeon } from '../src/sim/instances/dungeons';
import {
  isPinnedInPlace,
  PIN_PHASE_SECONDS,
  pinInPlace,
} from '../src/sim/instances/instance_combat_hold';
import {
  chaseRouteFor,
  followChaseRoute,
  ROUTE_AFTER_STALL_SECONDS,
  ROUTE_DENIED_TICKS,
  ROUTE_MAX_TRIES,
  ROUTE_NODES_PER_PLAN,
  ROUTE_NODES_PER_TICK,
  ROUTE_REPLAN_TICKS,
  ROUTE_STUCK_TICKS,
  ROUTE_TRY_FORGIVE_TICKS,
  routeSearchOpts,
  routesHere,
} from '../src/sim/mob/chase_route';
import { startEvadeHome } from '../src/sim/mob/combat_profile';
import { isBossTemplate, isEncounterBody } from '../src/sim/mob/encounter_body';
import { CHASE_STALL_TIMEOUT } from '../src/sim/mob/reachability';
import { searchRoute } from '../src/sim/mob/route_search';
import { resetMobScanCounters } from '../src/sim/mob/scan_counters';
import { Sim } from '../src/sim/sim';
import { addThreat } from '../src/sim/threat';
import { DT, dist2d, type Entity } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';
import { cryptFight, type Fight, put, tick } from './helpers/crypt_boss_fight';

vi.setConfig({ testTimeout: 240_000 });

const WARRIOR = 'crypt_ossuary_warrior';
const ADEPT = 'crypt_gravecaller_adept';
/** North of the curtain wall (z 21, x 7 to 46), and south of it. */
const NORTH = { x: 18, z: 30 };
const SOUTH = { x: 18, z: 12 };
/** The wall's faces along z. */
const WALL_NORTH_FACE = 22.2;
const WALL_SOUTH_FACE = 19.8;

interface Scene {
  f: Fight;
  mob: Entity;
  keep: () => void;
  /** Tallies over every tick the scene ran (Sim.mobScanCounters). */
  plans: number;
  failed: number;
  maxNodes: number;
}

function spawn(f: Fight, templateId: string, at: { x: number; z: number }): Entity {
  const template = MOBS[templateId];
  const mob = createMob(
    f.sim.ctx.nextId++,
    mobTemplateForDungeonDifficulty(template, 'hollow_crypt', f.inst.difficulty),
    mobLevelForDungeonDifficulty('hollow_crypt', f.inst.difficulty, template.minLevel),
    f.sim.ctx.groundPos(f.ox + at.x, f.oz + at.z),
  );
  applyDungeonMobTuning(mob, 'hollow_crypt', f.inst.difficulty);
  mob.dungeonPackId = 'route';
  mob.maxHp = 1e7;
  mob.hp = 1e7;
  f.sim.ctx.addEntity(mob);
  f.inst.mobIds.push(mob.id);
  mob.aggroTargetId = f.tank.id;
  mob.inCombat = true;
  mob.aiState = 'chase';
  mob.leashAnchor = { ...mob.pos };
  addThreat(mob, f.tank.id, 100);
  return mob;
}

function scene(
  keep: ReadonlySet<string> = new Set(),
  at = NORTH,
  tank = SOUTH,
  templateId = WARRIOR,
): Scene {
  // Morthen stays entombed: dead, the fixture would raise his Knellwyrm into
  // the scene as a second engaged mob.
  const f = cryptFight('heroic', 0, new Set([...keep, 'morthen']));
  put(f, f.tank, tank.x, tank.z);
  // The living packs of a shut-gate scene stay asleep.
  f.tank.devNoAggro = true;
  // One tick so the claim's gates are published to collision.
  tick(f);
  const mob = spawn(f, templateId, at);
  return { f, mob, keep: () => put(f, f.tank, tank.x, tank.z), plans: 0, failed: 0, maxNodes: 0 };
}

function step(s: Scene): void {
  tick(s.f, s.keep);
  const c = s.f.sim.mobScanCounters;
  s.plans += c.routePlans;
  s.failed += c.routeFailed;
  s.maxNodes = Math.max(s.maxNodes, c.routeNodes);
}

function local(s: Scene, mob: Entity = s.mob): { x: number; z: number } {
  return { x: mob.pos.x - s.f.ox, z: mob.pos.z - s.f.oz };
}

function inWall(s: Scene, mob: Entity = s.mob): boolean {
  return isBlocked(s.f.sim.cfg.seed, mob.pos.x, mob.pos.z, 0.35);
}

function meleeHits(s: Scene): number {
  return s.f.hits.filter((h) => h.targetId === s.f.tank.id).length;
}

/** Put the sim's clock on this mob's next allowed plan tick, with a fresh
 *  per-tick tally (the sim resets it at the top of a tick; a direct call here
 *  stands in for that). */
function toPlanTick(s: Scene, mob: Entity = s.mob): void {
  const clock = s.f.sim as unknown as { tickCount: number };
  const at = chaseRouteFor(s.f.sim.ctx, mob, s.f.tank).planAt;
  clock.tickCount = Math.max(clock.tickCount + 1, at);
  resetMobScanCounters(s.f.sim.mobScanCounters as never);
}

describe('a melee mob whose target stands across a wall with a doorway', () => {
  it('walks through the doorway and fights, never held and never through the wall', () => {
    const s = scene();
    expect(routesHere(s.f.sim.ctx, s.mob, s.f.tank)).toBe(true);
    let crossedAtX: number | null = null;
    let prevZ = local(s).z;
    let worstStall = 0;
    let reached = -1;
    for (let i = 0; i < 20 / DT && reached < 0; i++) {
      step(s);
      const at = local(s);
      if (crossedAtX === null && prevZ > 21 && at.z <= 21) crossedAtX = at.x;
      prevZ = at.z;
      worstStall = Math.max(worstStall, s.mob.chaseStall);
      expect(inWall(s)).toBe(false);
      // Inside the wall's thickness it is only ever in the gateway.
      if (at.z < WALL_NORTH_FACE && at.z > WALL_SOUTH_FACE) expect(Math.abs(at.x)).toBeLessThan(7);
      expect(isPinnedInPlace(s.mob)).toBe(false);
      expect(s.mob.aiState).not.toBe('evade');
      if (meleeHits(s) > 0) reached = i;
    }
    expect(reached).toBeGreaterThan(0);
    expect(crossedAtX).not.toBeNull();
    expect(Math.abs(crossedAtX as unknown as number)).toBeLessThan(7);
    // It turned for the gate well inside the stall window: the short pause at
    // the wall and at most one re-plan period for its slot, never the five
    // seconds that end in the hold.
    expect(worstStall).toBeGreaterThanOrEqual(ROUTE_AFTER_STALL_SECONDS - DT);
    expect(worstStall).toBeLessThan(ROUTE_AFTER_STALL_SECONDS + ROUTE_REPLAN_TICKS * DT + 0.2);
    // The whole detour (about 35 yd) took walking time, not the 15 s of the
    // old stall, hold and phase.
    expect(reached * DT).toBeLessThan(11);
    expect(dist2d(s.mob.pos, s.f.tank.pos)).toBeLessThan(6);
    // One search, inside its cap and the tick's budget.
    expect(s.plans).toBe(1);
    expect(s.failed).toBe(0);
    expect(s.maxNodes).toBeGreaterThan(0);
    expect(s.maxNodes).toBeLessThanOrEqual(ROUTE_NODES_PER_PLAN);
  });

  it('is deterministic from the seed', () => {
    const walk = (): string => {
      const s = scene();
      const trail: string[] = [];
      for (let i = 0; i < 8 / DT; i++) {
        step(s);
        if (i % 10 === 0) trail.push(`${s.mob.pos.x.toFixed(4)},${s.mob.pos.z.toFixed(4)}`);
      }
      return `${trail.join('|')} plans ${s.plans} nodes ${s.maxNodes}`;
    };
    expect(walk()).toBe(walk());
  });
});

describe('a melee mob with open ground ahead', () => {
  it('chases straight and never plans a route', () => {
    const s = scene(new Set(), { x: 13, z: -44 }, { x: 13, z: -20 });
    const start = local(s);
    let offLine = 0;
    for (let i = 0; i < 6 / DT && meleeHits(s) === 0; i++) {
      step(s);
      offLine = Math.max(offLine, Math.abs(local(s).x - start.x));
      expect(s.mob.chaseRoute).toBeUndefined();
      expect(s.mob.chaseStall).toBe(0);
    }
    expect(meleeHits(s)).toBeGreaterThan(0);
    expect(offLine).toBeLessThan(0.5);
    expect(s.plans).toBe(0);
  });
});

describe('a melee mob with no way round', () => {
  it('stalls, holds immune and phases exactly as before, on a few bounded searches', () => {
    // A cloister Necromancer left alive keeps the Undercroft Grille shut.
    const s = scene(new Set(['crypt_gravecaller_necromancer']));
    let pinnedAt = -1;
    let through = -1;
    let pathWhenPinned: number | null = null;
    for (let i = 0; i < (CHASE_STALL_TIMEOUT + PIN_PHASE_SECONDS + 6) / DT && through < 0; i++) {
      step(s);
      if (pinnedAt < 0 && isPinnedInPlace(s.mob)) {
        pinnedAt = i * DT;
        pathWhenPinned = s.mob.chaseRoute?.path.length ?? 0;
      }
      if (meleeHits(s) > 0) through = i * DT;
      expect(s.mob.aiState).not.toBe('evade');
    }
    // The stall window, measured from when it reached the wall.
    expect(pinnedAt).toBeGreaterThan(CHASE_STALL_TIMEOUT);
    expect(pinnedAt).toBeLessThan(CHASE_STALL_TIMEOUT + 2.5);
    // Held, it carries no path to walk back to.
    expect(pathWhenPinned).toBe(0);
    // Then the hold's grace, then it comes through and fights.
    expect(through).toBeGreaterThan(pinnedAt + PIN_PHASE_SECONDS - 0.5);
    expect(local(s).z).toBeLessThan(WALL_SOUTH_FACE);
    // Every search failed, each inside the cap, and they backed off: one at
    // the wall, one two seconds later, never one a second.
    expect(s.plans).toBeGreaterThanOrEqual(1);
    expect(s.plans).toBeLessThanOrEqual(3);
    expect(s.failed).toBe(s.plans);
    expect(s.maxNodes).toBeLessThanOrEqual(ROUTE_NODES_PER_PLAN);
  });
});

describe('where routes are planned', () => {
  it('only for a mob and a target in one claimed instance slot', () => {
    const s = scene();
    expect(routesHere(s.f.sim.ctx, s.mob, s.f.tank)).toBe(true);
    // The same mob out in the open world, or its target there: no route.
    const there = { ...s.mob, pos: { x: 100, y: 0, z: 100 } } as Entity;
    expect(routesHere(s.f.sim.ctx, there, s.f.tank)).toBe(false);
    const away = { ...s.f.tank, pos: { x: 100, y: 0, z: 100 } } as Entity;
    expect(routesHere(s.f.sim.ctx, s.mob, away)).toBe(false);
  });

  it('an open-world melee mob walled off from its target plans nothing and still evades', () => {
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', autoEquip: false });
    const player = sim.player;
    const gate = (DAWNHOLD_GATES.main.a0 + DAWNHOLD_GATES.main.a1) / 2;
    // Inside Dawnhold's east curtain wall, 18 yd from its one gate.
    player.pos = sim.ctx.groundPos(DAWNHOLD.wx1 - 6, gate + 18);
    player.prevPos = { ...player.pos };
    player.maxHp = 1e9;
    player.hp = 1e9;
    sim.ctx.rebucket(player);
    const wolf = createMob(
      sim.ctx.nextId++,
      MOBS.forest_wolf,
      5,
      sim.ctx.groundPos(DAWNHOLD.wx1 + 8, gate + 18),
    );
    wolf.hostile = true;
    wolf.maxHp = 1e7;
    wolf.hp = 1e7;
    sim.ctx.addEntity(wolf);
    wolf.aggroTargetId = player.id;
    wolf.inCombat = true;
    wolf.aiState = 'chase';
    wolf.leashAnchor = { ...wolf.pos };
    addThreat(wolf, player.id, 100);
    let plans = 0;
    let evaded = false;
    for (let i = 0; i < (CHASE_STALL_TIMEOUT + 6) / DT && !evaded; i++) {
      player.hp = player.maxHp;
      sim.tick();
      plans += sim.mobScanCounters.routePlans;
      if ((wolf.aiState as string) === 'evade') evaded = true;
      // The wall holds it: it never gets inside.
      expect(wolf.pos.x).toBeGreaterThan(DAWNHOLD.wx1);
    }
    expect(evaded).toBe(true);
    expect(plans).toBe(0);
    expect(wolf.chaseRoute).toBeUndefined();
  });
});

describe('the search itself', () => {
  it('stops at its node cap, found or not, and a perch is no route', () => {
    const s = scene(new Set(['crypt_gravecaller_necromancer']));
    const opts = {
      seed: s.f.sim.cfg.seed,
      margin: 24,
      maxNodes: ROUTE_NODES_PER_PLAN,
      swim: false,
      riftToken: 0,
    };
    const at = (p: { x: number; z: number }) => ({ x: s.f.ox + p.x, z: s.f.oz + p.z });
    // The wall with its gate shut: nothing, and no more than the cap judged.
    const shut = searchRoute(at(NORTH), at(SOUTH), opts);
    expect(shut.found).toBe(false);
    expect(shut.path).toEqual([]);
    expect(shut.nodes).toBeGreaterThan(100);
    expect(shut.nodes).toBeLessThanOrEqual(ROUTE_NODES_PER_PLAN);
    // A tighter cap is obeyed to the cell.
    const tight = searchRoute(at(NORTH), at(SOUTH), { ...opts, maxNodes: 120 });
    expect(tight.found).toBe(false);
    expect(tight.nodes).toBe(120);
    // A target standing in the middle of the Ossuary Monument (a 5 yd pillar):
    // no cell a body can stand on is within reach of it, so there is no route
    // to the foot of the perch.
    const perch = searchRoute(at({ x: 0, z: -38.5 }), at({ x: 0, z: -30 }), opts);
    expect(perch.found).toBe(false);
    // A window wider than the search accepts is refused before a cell is judged.
    const wide = searchRoute(at({ x: 0, z: -100 }), at({ x: 0, z: 0 }), opts);
    expect(wide).toEqual({ attempted: false, found: false, nodes: 0, path: [] });
    // Every search that ran says so, found or not.
    expect(shut.attempted).toBe(true);
    expect(perch.attempted).toBe(true);
    // And a clear straight line is one waypoint: nothing to walk round.
    const clear = searchRoute(at({ x: 13, z: -44 }), at({ x: 13, z: -20 }), opts);
    expect(clear.found).toBe(true);
    expect(clear.path).toHaveLength(1);
  });

  it('finds the doorway, and the same route every time', () => {
    const s = scene();
    const opts = {
      seed: s.f.sim.cfg.seed,
      margin: 24,
      maxNodes: ROUTE_NODES_PER_PLAN,
      swim: false,
      riftToken: 0,
    };
    const from = { x: s.f.ox + NORTH.x, z: s.f.oz + NORTH.z };
    const to = { x: s.f.ox + SOUTH.x, z: s.f.oz + SOUTH.z };
    const a = searchRoute(from, to, opts);
    expect(a.found).toBe(true);
    expect(a.path.length).toBeGreaterThan(1);
    expect(a.path[a.path.length - 1]).toEqual(to);
    // Every waypoint stands clear of the wall, and one of them is in the gateway.
    for (const w of a.path.slice(0, -1)) expect(isBlocked(opts.seed, w.x, w.z, 0.5)).toBe(false);
    expect(a.path.some((w) => Math.abs(w.x - s.f.ox) < 7 && Math.abs(w.z - s.f.oz - 21) < 4)).toBe(
      true,
    );
    // Scratch buffers carry nothing over: a different search in between, then
    // the same one again, gives the same answer.
    searchRoute(to, { x: s.f.ox, z: s.f.oz - 30 }, opts);
    expect(searchRoute(from, to, opts)).toEqual(a);
  });
});

describe('the route guards', () => {
  it('spends at most its tries, and nothing the target does hands them back: only time does', () => {
    const s = scene();
    const ctx = s.f.sim.ctx;
    let walked = 0;
    for (let round = 0; round < ROUTE_MAX_TRIES + 3; round++) {
      // Back on the far side with its path thrown away; the target shuffles
      // 4 yd each round (a doorway dance), which buys nothing.
      put(s.f, s.mob, NORTH.x, NORTH.z);
      put(s.f, s.f.tank, SOUTH.x + (round % 2) * 4, SOUTH.z);
      if (s.mob.chaseRoute) s.mob.chaseRoute.path = [];
      toPlanTick(s);
      if (followChaseRoute(ctx, s.mob, s.f.tank, 7)) walked++;
    }
    expect(walked).toBe(ROUTE_MAX_TRIES);
    expect(s.mob.chaseRoute?.tries).toBe(ROUTE_MAX_TRIES);
    // One forgiveness period later exactly one plan is back.
    const clock = s.f.sim as unknown as { tickCount: number };
    clock.tickCount = (s.mob.chaseRoute?.triesAt ?? 0) + ROUTE_TRY_FORGIVE_TICKS;
    put(s.f, s.mob, NORTH.x, NORTH.z);
    if (s.mob.chaseRoute) s.mob.chaseRoute.path = [];
    toPlanTick(s);
    expect(followChaseRoute(ctx, s.mob, s.f.tank, 7)).toBe(true);
    put(s.f, s.mob, NORTH.x, NORTH.z);
    if (s.mob.chaseRoute) s.mob.chaseRoute.path = [];
    toPlanTick(s);
    expect(followChaseRoute(ctx, s.mob, s.f.tank, 7)).toBe(false);
  });

  it('a failed search counts against the tries and doubles the wait each time', () => {
    const s = scene(new Set(['crypt_gravecaller_necromancer']));
    const ctx = s.f.sim.ctx;
    const clock = s.f.sim as unknown as { tickCount: number };
    const waits: number[] = [];
    for (let k = 0; k < 3; k++) {
      toPlanTick(s);
      // No packmate's word to take: each of these is its own search.
      s.f.tank.routeDenied = undefined;
      const before = s.mob.chaseRoute?.tries ?? 0;
      expect(followChaseRoute(ctx, s.mob, s.f.tank, 7)).toBe(false);
      expect(s.f.sim.mobScanCounters.routePlans).toBe(1);
      expect(s.f.sim.mobScanCounters.routeFailed).toBe(1);
      // Charged like a found route (a try the wait may since have handed back).
      expect(s.mob.chaseRoute?.tries).toBeGreaterThanOrEqual(1);
      expect(s.mob.chaseRoute?.tries).toBeLessThanOrEqual(before + 1);
      expect(s.mob.chaseRoute?.fails).toBe(k + 1);
      waits.push((s.mob.chaseRoute?.planAt ?? 0) - clock.tickCount);
      // Asked again before its wait is out, it searches nothing.
      resetMobScanCounters(s.f.sim.mobScanCounters as never);
      clock.tickCount += 1;
      expect(followChaseRoute(ctx, s.mob, s.f.tank, 7)).toBe(false);
      expect(s.f.sim.mobScanCounters.routePlans).toBe(0);
    }
    // Two seconds, four, eight (each rounded up to the mob's own slot).
    for (let k = 0; k < waits.length; k++) {
      const base = ROUTE_REPLAN_TICKS * 2 ** (k + 1);
      expect(waits[k]).toBeGreaterThanOrEqual(base);
      expect(waits[k]).toBeLessThan(base + ROUTE_REPLAN_TICKS);
    }
  });

  it('a pack takes the word of the mob that asked: one failed search, not one a mob', () => {
    const s = scene(new Set(['crypt_gravecaller_necromancer']));
    const ctx = s.f.sim.ctx;
    const pack = [s.mob];
    for (let i = 1; i < 6; i++)
      pack.push(spawn(s.f, WARRIOR, { x: NORTH.x + i * 1.2, z: NORTH.z }));
    const clock = s.f.sim as unknown as { tickCount: number };
    // All of them due on this tick.
    clock.tickCount += ROUTE_REPLAN_TICKS * 2;
    for (const mob of pack) chaseRouteFor(ctx, mob, s.f.tank).planAt = clock.tickCount;
    resetMobScanCounters(s.f.sim.mobScanCounters as never);
    for (const mob of pack) expect(followChaseRoute(ctx, mob, s.f.tank, 7)).toBe(false);
    const tally = s.f.sim.mobScanCounters;
    expect(tally.routePlans).toBe(1);
    expect(tally.routeFailed).toBe(1);
    expect(s.f.tank.routeDenied?.tick).toBe(clock.tickCount);
    // Every one of them is charged a try and backs off, searched or not.
    for (const mob of pack) {
      expect(mob.chaseRoute?.tries).toBeGreaterThanOrEqual(1);
      expect(mob.chaseRoute?.fails).toBeGreaterThanOrEqual(1);
      expect(mob.chaseRoute?.planAt ?? 0).toBeGreaterThan(clock.tickCount + ROUTE_REPLAN_TICKS);
    }
    // The word goes stale: a few seconds on, a mob searches for itself again.
    clock.tickCount += ROUTE_DENIED_TICKS + 1;
    const late = spawn(s.f, WARRIOR, { x: NORTH.x - 1.5, z: NORTH.z });
    chaseRouteFor(ctx, late, s.f.tank).planAt = clock.tickCount;
    resetMobScanCounters(s.f.sim.mobScanCounters as never);
    followChaseRoute(ctx, late, s.f.tank, 7);
    expect(s.f.sim.mobScanCounters.routePlans).toBe(1);
  });

  it('the whole sim judges no more than its budget of cells in one tick, and nobody is starved', () => {
    // Twelve casters north of the wall, their target south of it: every one of
    // them needs the route through the gate.
    const s = scene(new Set(), { x: 9, z: 27 }, SOUTH, ADEPT);
    const pack = [s.mob];
    for (let i = 1; i < 12; i++)
      pack.push(spawn(s.f, ADEPT, { x: 9 + (i % 4) * 2.4, z: 27 + Math.floor(i / 4) * 2.4 }));
    const seeing = (): number =>
      pack.filter((m) => m.aiState === 'attack' && s.f.sim.ctx.hasLineOfSight(m, s.f.tank)).length;
    let maxPlansInTick = 0;
    for (let i = 0; i < 30 / DT && seeing() < pack.length; i++) {
      step(s);
      maxPlansInTick = Math.max(maxPlansInTick, s.f.sim.mobScanCounters.routePlans);
      // The budget, every tick.
      expect(s.f.sim.mobScanCounters.routeNodes).toBeLessThanOrEqual(ROUTE_NODES_PER_TICK);
      for (const m of pack) {
        expect(inWall(s, m)).toBe(false);
        expect(isPinnedInPlace(m)).toBe(false);
      }
    }
    // All twelve found their sight line.
    expect(seeing()).toBe(pack.length);
    expect(s.maxNodes).toBeGreaterThan(0);
    expect(s.maxNodes).toBeLessThanOrEqual(ROUTE_NODES_PER_TICK);
    // Spread over their slots: never the whole pack on one tick.
    expect(maxPlansInTick).toBeLessThanOrEqual(3);
    expect(s.plans).toBeGreaterThanOrEqual(pack.length);
  });

  it('drops a route that stops bringing it nearer its waypoint, and then chases straight', () => {
    // Open ground between the warrior and its target, and a route whose next
    // waypoint lies in the heart of the Ossuary Monument, where no body goes.
    const s = scene(new Set(), { x: 13, z: -44 }, { x: 13, z: -20 });
    const ctx = s.f.sim.ctx;
    const o = { x: s.f.ox, z: s.f.oz };
    followChaseRoute(ctx, s.mob, s.f.tank, 7);
    const route = s.mob.chaseRoute;
    if (!route) throw new Error('no route record');
    route.path = [
      { x: o.x + 0, y: 0, z: o.z - 30 },
      { x: s.f.tank.pos.x, y: 0, z: s.f.tank.pos.z },
    ];
    route.planAt = s.f.sim.tickCount + 100000;
    route.stuckDist = Infinity;
    route.stuckAt = s.f.sim.tickCount;
    let droppedAt = -1;
    let stillSince = -1;
    let longestStill = 0;
    let prev = local(s);
    for (let i = 0; i < 20 / DT && meleeHits(s) === 0; i++) {
      step(s);
      const at = local(s);
      const moved = Math.hypot(at.x - prev.x, at.z - prev.z) > 1e-3;
      prev = at;
      if (!moved) {
        if (stillSince < 0) stillSince = i;
        longestStill = Math.max(longestStill, i - stillSince + 1);
      } else stillSince = -1;
      if (droppedAt < 0 && (s.mob.chaseRoute?.path.length ?? 0) === 0) droppedAt = i;
      expect(s.mob.aiState).not.toBe('evade');
      expect(isPinnedInPlace(s.mob)).toBe(false);
    }
    // The watchdog let go of it, counted it as a failure, and it went straight.
    expect(droppedAt).toBeGreaterThan(0);
    expect(s.mob.chaseRoute?.fails).toBeGreaterThanOrEqual(1);
    expect(longestStill).toBeLessThanOrEqual(ROUTE_STUCK_TICKS + 2);
    expect(meleeHits(s)).toBeGreaterThan(0);
  });

  it('a mob the instance hold pins carries no path', () => {
    const s = scene();
    followChaseRoute(s.f.sim.ctx, s.mob, s.f.tank, 7);
    const route = s.mob.chaseRoute;
    if (!route) throw new Error('no route record');
    route.path = [
      { x: 1, y: 0, z: 1 },
      { x: 2, y: 0, z: 2 },
    ];
    const tries = route.tries;
    pinInPlace(s.mob);
    expect(s.mob.chaseRoute?.path).toEqual([]);
    // The throttle is not forgiven by the hold.
    expect(s.mob.chaseRoute?.tries).toBe(tries);
  });
});

describe('what the players cannot buy back', () => {
  it('a mob that changes target keeps its plan clock, its spent tries and its failures', () => {
    const s = scene();
    const ctx = s.f.sim.ctx;
    const route = chaseRouteFor(ctx, s.mob, s.f.tank);
    route.tries = 3;
    route.triesAt = s.f.sim.tickCount;
    route.fails = 2;
    route.planAt = s.f.sim.tickCount + 500;
    route.path = [
      { x: 1, y: 0, z: 1 },
      { x: 2, y: 0, z: 2 },
    ];
    route.sightClear = false;
    route.stuckDist = 4;
    const other = { ...s.f.tank, id: s.f.tank.id + 5000 } as Entity;
    const carried = chaseRouteFor(ctx, s.mob, other);
    // The same record, pointed at the new target.
    expect(carried).toBe(route);
    expect(carried.targetId).toBe(other.id);
    // The throttle is the mob's, not the target's.
    expect(carried.tries).toBe(3);
    expect(carried.fails).toBe(2);
    expect(carried.planAt).toBe(s.f.sim.tickCount + 500);
    // What belonged to the old target is gone.
    expect(carried.path).toEqual([]);
    expect(carried.sightClear).toBe(true);
    expect(carried.stuckDist).toBe(Infinity);
    // And back again: still nothing handed back.
    expect(chaseRouteFor(ctx, s.mob, s.f.tank).tries).toBe(3);
  });

  it('a target that drops off the threat table for a moment hands back nothing', () => {
    const f = cryptFight('heroic', 1, new Set(['morthen']));
    put(f, f.tank, SOUTH.x, SOUTH.z);
    put(f, f.others[0], SOUTH.x + 3, SOUTH.z);
    tick(f);
    const mob = spawn(f, WARRIOR, NORTH);
    addThreat(mob, f.others[0].id, 50);
    const route = chaseRouteFor(f.sim.ctx, mob, f.tank);
    route.tries = 3;
    route.triesAt = f.sim.tickCount;
    route.fails = 2;
    // Its target is gone from the fight for a tick (a Vanish, a feigned death).
    f.tank.dead = true;
    tick(f);
    f.tank.dead = false;
    expect(mob.aggroTargetId).toBe(f.others[0].id);
    expect(mob.aiState).not.toBe('evade');
    // The record lived through the tick with no target, throttle and all.
    expect(mob.chaseRoute).toBe(route);
    expect(mob.chaseRoute?.tries).toBe(3);
    expect(mob.chaseRoute?.fails).toBe(2);
    // Only the end of the pull drops it.
    startEvadeHome(mob);
    expect(mob.chaseRoute).toBeUndefined();
  });

  it('with its tries spent, a route whose end the target has left is dropped, and it closes on a target in plain sight', () => {
    const s = scene();
    // Let it reach the wall, plan its way to the doorway and set off.
    for (let i = 0; i < 10 / DT && (s.mob.chaseRoute?.path.length ?? 0) <= 1; i++) step(s);
    const route = s.mob.chaseRoute;
    if (!route || route.path.length <= 1) throw new Error('no route was planned');
    const plans = s.plans;
    // No plan left, and none coming back for ten seconds.
    route.tries = ROUTE_MAX_TRIES;
    route.triesAt = s.f.sim.tickCount;
    // The target comes round to the mob's own side of the wall, in the open.
    const here = local(s);
    const open = { x: here.x - 7, z: here.z + 5 };
    s.keep = () => put(s.f, s.f.tank, open.x, open.z);
    s.keep();
    expect(s.f.sim.ctx.hasLineOfSight(s.mob, s.f.tank)).toBe(true);
    let nearest = dist2d(s.mob.pos, s.f.tank.pos);
    for (let i = 0; i < 6 / DT && meleeHits(s) === 0; i++) {
      step(s);
      const d = dist2d(s.mob.pos, s.f.tank.pos);
      // Never walked away from it along the old route.
      expect(d).toBeLessThan(nearest + 0.2);
      nearest = Math.min(nearest, d);
    }
    expect(meleeHits(s)).toBeGreaterThan(0);
    // The stale path was thrown away, and nothing was searched to replace it.
    expect(s.plans).toBe(plans);
    expect(s.mob.chaseRoute?.path ?? []).toEqual([]);
  });

  it('a search refused because the pair is too far apart costs nothing', () => {
    // Fifty yards apart along the nave: wider than the search window.
    const s = scene(new Set(), { x: 13, z: -44 }, { x: 13, z: 6 });
    const ctx = s.f.sim.ctx;
    const opts = routeSearchOpts(ctx, s.mob);
    const refused = searchRoute(s.mob.pos, s.f.tank.pos, opts);
    expect(refused).toEqual({ attempted: false, found: false, nodes: 0, path: [] });
    toPlanTick(s);
    s.f.tank.routeDenied = undefined;
    const now = s.f.sim.tickCount;
    expect(followChaseRoute(ctx, s.mob, s.f.tank, 7)).toBe(false);
    const tally = s.f.sim.mobScanCounters;
    expect(tally.routePlans).toBe(0);
    expect(tally.routeNodes).toBe(0);
    expect(tally.routeFailed).toBe(0);
    // No try spent, no backoff, and nobody is told there is no route.
    expect(s.mob.chaseRoute?.tries).toBe(0);
    expect(s.mob.chaseRoute?.fails).toBe(0);
    expect(s.f.tank.routeDenied).toBeUndefined();
    // It asks again one period on, on its own slot.
    const wait = (s.mob.chaseRoute?.planAt ?? 0) - now;
    expect(wait).toBeGreaterThanOrEqual(ROUTE_REPLAN_TICKS);
    expect(wait).toBeLessThan(ROUTE_REPLAN_TICKS * 2);
  });

  it("the word of a mob that moves another way, or one from a tick that has not come, is nobody's proof", () => {
    const s = scene(new Set(['crypt_gravecaller_necromancer']));
    const ctx = s.f.sim.ctx;
    // How this mob moves: a word counts only from a mob that moves the same way.
    const mine = routeSearchOpts(ctx, s.mob).swim;
    const word = (over: Partial<NonNullable<Entity['routeDenied']>>) => ({
      tick: s.f.sim.tickCount,
      x: s.f.tank.pos.x,
      z: s.f.tank.pos.z,
      fromX: s.mob.pos.x,
      fromZ: s.mob.pos.z,
      swim: mine,
      ...over,
    });
    // A fresh word from a mob like it, beside it: taken, nothing searched.
    toPlanTick(s);
    s.f.tank.routeDenied = word({});
    followChaseRoute(ctx, s.mob, s.f.tank, 7);
    expect(s.f.sim.mobScanCounters.routePlans).toBe(0);
    expect(s.mob.chaseRoute?.fails).toBe(1);
    // From a mob that moves the other way: it searches for itself.
    toPlanTick(s);
    s.f.tank.routeDenied = word({ swim: !mine });
    followChaseRoute(ctx, s.mob, s.f.tank, 7);
    expect(s.f.sim.mobScanCounters.routePlans).toBe(1);
    // One stamped with a tick that has not come: it searches for itself.
    toPlanTick(s);
    s.f.tank.routeDenied = word({ tick: s.f.sim.tickCount + 5 });
    followChaseRoute(ctx, s.mob, s.f.tank, 7);
    expect(s.f.sim.mobScanCounters.routePlans).toBe(1);
  });
});

describe('who plans a route at all', () => {
  it('not a boss, a mid-boss, a scripted great body or a pet', () => {
    const s = scene();
    const ctx = s.f.sim.ctx;
    const as = (templateId: string): Entity => ({ ...s.mob, templateId }) as Entity;
    expect(routesHere(ctx, s.mob, s.f.tank)).toBe(true);
    // A flagged final boss.
    expect(MOBS.morthen.boss).toBe(true);
    expect(routesHere(ctx, as('morthen'), s.f.tank)).toBe(false);
    // The mid-bosses carry no boss flag; their gate's roster names them.
    expect(MOBS.sexton_marrow.boss).not.toBe(true);
    expect(isBossTemplate('sexton_marrow')).toBe(true);
    expect(routesHere(ctx, as('sexton_marrow'), s.f.tank)).toBe(false);
    expect(routesHere(ctx, as('rimeweb'), s.f.tank)).toBe(false);
    expect(routesHere(ctx, as('fanglord_jaguar'), s.f.tank)).toBe(false);
    // A scripted great body that is no boss.
    expect(isBossTemplate('sledge_tusker')).toBe(false);
    expect(isEncounterBody('sledge_tusker')).toBe(true);
    expect(routesHere(ctx, as('sledge_tusker'), s.f.tank)).toBe(false);
    // Somebody's pet.
    expect(routesHere(ctx, { ...s.mob, ownerId: s.f.tank.id } as Entity, s.f.tank)).toBe(false);
    // Ordinary trash, melee and caster.
    expect(isEncounterBody(WARRIOR)).toBe(false);
    expect(isEncounterBody(ADEPT)).toBe(false);
  });

  it('a boss walled off from its target searches nothing and falls to the hold, as before', () => {
    // A boss of another dungeon, so no crypt encounter script owns it: the
    // gate shut, its target across the wall.
    const bossId = Object.keys(MOBS).find(
      (id) => MOBS[id].boss === true && !MOBS[id].worldBoss && !MOBS[id].petSpell,
    );
    if (!bossId) throw new Error('no plain boss template in content');
    const s = scene(new Set(['crypt_gravecaller_necromancer']), NORTH, SOUTH, bossId);
    expect(isBossTemplate(s.mob.templateId)).toBe(true);
    let pinnedAt = -1;
    for (let i = 0; i < (CHASE_STALL_TIMEOUT + 6) / DT && pinnedAt < 0; i++) {
      step(s);
      expect(s.f.sim.mobScanCounters.routePlans).toBe(0);
      expect(s.f.sim.mobScanCounters.routeDeferred).toBe(0);
      if (isPinnedInPlace(s.mob)) pinnedAt = i * DT;
    }
    // No search, no route record: the straight chase, the stall, the hold.
    expect(s.plans).toBe(0);
    expect(s.mob.chaseRoute).toBeUndefined();
    expect(pinnedAt).toBeGreaterThan(CHASE_STALL_TIMEOUT - 0.5);
    expect(local(s).z).toBeGreaterThan(WALL_NORTH_FACE - 1);
  });
});

describe("the tick's route budget is shared fairly", () => {
  it('two mobs due on one tick: the first in entity order is served, the second goes to its own next slot', () => {
    const s = scene(new Set(['crypt_gravecaller_necromancer']));
    const ctx = s.f.sim.ctx;
    // Far enough along the wall that neither takes the other's word.
    const far = spawn(s.f, WARRIOR, { x: NORTH.x + 20, z: NORTH.z });
    expect(far.id).toBeGreaterThan(s.mob.id);
    const clock = s.f.sim as unknown as { tickCount: number };
    clock.tickCount += ROUTE_REPLAN_TICKS * 2;
    const now = clock.tickCount;
    for (const mob of [s.mob, far]) chaseRouteFor(ctx, mob, s.f.tank).planAt = now;
    s.f.tank.routeDenied = undefined;
    resetMobScanCounters(s.f.sim.mobScanCounters as never);
    followChaseRoute(ctx, s.mob, s.f.tank, 7);
    followChaseRoute(ctx, far, s.f.tank, 7);
    const tally = s.f.sim.mobScanCounters;
    // One capped search, and the second mob put off.
    expect(tally.routePlans).toBe(1);
    expect(tally.routeNodes).toBe(ROUTE_NODES_PER_PLAN);
    expect(tally.routeDeferred).toBe(1);
    expect(s.mob.chaseRoute?.tries).toBe(1);
    // Put off, not charged: no try, no failure, and not back next tick but on
    // its own slot of the next period.
    expect(far.chaseRoute?.tries).toBe(0);
    expect(far.chaseRoute?.fails).toBe(0);
    const wait = (far.chaseRoute?.planAt ?? 0) - now;
    expect(wait).toBeGreaterThan(1);
    expect(wait).toBeLessThanOrEqual(ROUTE_REPLAN_TICKS);
    expect(Math.abs(((far.chaseRoute?.planAt ?? 0) - far.id) % ROUTE_REPLAN_TICKS)).toBe(0);
    // Asked again on the very next tick, it is not even counted as deferred.
    clock.tickCount += 1;
    resetMobScanCounters(s.f.sim.mobScanCounters as never);
    followChaseRoute(ctx, far, s.f.tank, 7);
    expect(s.f.sim.mobScanCounters.routePlans).toBe(0);
    expect(s.f.sim.mobScanCounters.routeDeferred).toBe(0);
  });

  it('a forty-mob blocked pull in one instance does not starve a mob in another', () => {
    // Instance A: the gate shut, forty warriors along the wall, none with a way.
    const s = scene(new Set(['crypt_gravecaller_necromancer']));
    const sim = s.f.sim;
    for (let i = 1; i < 40; i++) {
      spawn(s.f, WARRIOR, { x: 9 + (i % 20) * 1.8, z: NORTH.z + Math.floor(i / 20) * 2 });
    }
    // Instance B: a second party of one, its crypt cleared (the gate open), one
    // warrior with the doorway between it and its target. It is the newest
    // entity in the sim: last in entity order, the worst place in the queue.
    const pid = sim.addPlayer('mage', 'Elsewhere');
    sim.chat('/dev level 20', pid);
    enterDungeon(sim.ctx, 'hollow_crypt', pid);
    const visitor = sim.ctx.entities.get(pid) as Entity;
    const instB = claimedInstanceAt(sim.ctx, visitor.pos);
    if (!instB || instB === s.f.inst) throw new Error('no second claim');
    for (const id of instB.mobIds) {
      const e = sim.ctx.entities.get(id);
      if (e && !e.dead && e.templateId !== 'morthen') sim.ctx.handleDeath(e, visitor);
    }
    const o = instanceOrigin(DUNGEONS.hollow_crypt.index, instB.slot);
    const b: Fight = { ...s.f, inst: instB, ox: o.x, oz: o.z, tank: visitor, others: [] };
    visitor.maxHp = 1e7;
    visitor.hp = 1e7;
    visitor.devNoAggro = true;
    const holdB = (): void => put(b, visitor, SOUTH.x, SOUTH.z);
    holdB();
    tick(s.f, () => {
      s.keep();
      holdB();
    });
    const lone = spawn(b, WARRIOR, NORTH);
    let askedAt = -1;
    let servedAt = -1;
    let deferred = 0;
    for (let i = 0; i < 20 / DT && servedAt < 0; i++) {
      visitor.hp = 1e7;
      tick(s.f, () => {
        s.keep();
        holdB();
      });
      const c = sim.mobScanCounters;
      deferred += c.routeDeferred;
      // The budget, every tick, with both instances asking.
      expect(c.routeNodes).toBeLessThanOrEqual(ROUTE_NODES_PER_TICK);
      if (askedAt < 0 && lone.chaseRoute !== undefined) askedAt = i;
      if ((lone.chaseRoute?.path.length ?? 0) > 1) servedAt = i;
    }
    expect(askedAt).toBeGreaterThanOrEqual(0);
    expect(servedAt).toBeGreaterThanOrEqual(askedAt);
    // Served within a bounded wait of first asking: at worst its own slot,
    // then a slot or two lost to mobs of the other instance due on it.
    expect(servedAt - askedAt).toBeLessThanOrEqual(ROUTE_REPLAN_TICKS * 3);
    // And it walks its doorway while the other instance is still stuck.
    let through = false;
    for (let i = 0; i < 20 / DT && !through; i++) {
      visitor.hp = 1e7;
      tick(s.f, () => {
        s.keep();
        holdB();
      });
      deferred += sim.mobScanCounters.routeDeferred;
      expect(sim.mobScanCounters.routeNodes).toBeLessThanOrEqual(ROUTE_NODES_PER_TICK);
      through = lone.pos.z - o.z < WALL_SOUTH_FACE;
    }
    expect(through).toBe(true);
    expect(isBlocked(sim.cfg.seed, lone.pos.x, lone.pos.z, 0.35)).toBe(false);
  });
});

describe('the watchdog and a mob that is only slow', () => {
  it('a route walked at a crawl is not called wedged', () => {
    const s = scene(new Set(), { x: 13, z: -44 }, { x: 13, z: -20 });
    const ctx = s.f.sim.ctx;
    const clock = s.f.sim as unknown as { tickCount: number };
    const route = chaseRouteFor(ctx, s.mob, s.f.tank);
    const o = { x: s.f.ox, z: s.f.oz };
    // A real leg of open floor ahead of it, and no re-plan to muddy the watch.
    route.path = [
      { x: o.x + 13, y: 0, z: o.z - 36 },
      { x: s.f.tank.pos.x, y: 0, z: s.f.tank.pos.z },
    ];
    route.planAt = clock.tickCount + 100000;
    const start = dist2d(s.mob.pos, route.path[0]);
    // A twentieth of a yard a second: half the watch's own yardstick, so an
    // unguarded watch would call it wedged at its first deadline.
    for (let i = 0; i < ROUTE_STUCK_TICKS * 6; i++) {
      clock.tickCount += 1;
      expect(followChaseRoute(ctx, s.mob, s.f.tank, 0.05)).toBe(true);
    }
    expect(route.fails).toBe(0);
    expect(route.path).toHaveLength(2);
    // It did creep forward the whole time.
    expect(dist2d(s.mob.pos, route.path[0])).toBeLessThan(start);
  });
});
