// Benchmark for mob route planning and the line-of-sight rule (src/sim/mob/
// chase_route.ts, mob/route_search.ts, mob/cast_sight.ts). It PRINTS numbers;
// it asserts nothing about wall time (a loaded machine would make that a coin
// toss). The counters it prints beside them (searches, cells judged, mobs
// deferred and sight queries per tick, Sim.mobScanCounters) are deterministic
// and are what the two per-tick budgets are judged by.
//
//   npx tsx scripts/mob_route_bench.ts
//
// What it measures:
//   single searches   in the open world (Dawnhold's east curtain wall and its
//                     one gate, on the shipped seed) and in a claimed heroic
//                     Hollow Crypt (the Undercroft Grille's curtain wall and
//                     the Ossuary Monument): a clear line, a wall detour, a
//                     perched target, the widest window. Each row prints what
//                     the search itself answered (found, none, refused).
//   a tick's budget   timed DIRECTLY, with no whole-tick noise: the most route
//                     work one tick can do (ROUTE_NODES_PER_TICK cells: one
//                     capped search and a second in the cells left) and the
//                     most sight work (SIGHT_QUERIES_PER_TICK queries), in the
//                     Hollow Crypt and in the dungeon interior with the most
//                     colliders (found by counting, not by name).
//   whole scenes      a pack of 20 casters whose target steps out of sight,
//                     and 10 casters with their target dancing across a
//                     doorway edge, each against the same scene with the
//                     target standing still: the per-tick counters, and the
//                     whole sim tick's time for reference.
// The searches are called directly in both worlds, to price them; the mob AI
// itself plans routes only inside a claimed instance, so the open world's
// scene rows show no search at all. A delve room is timed for the sight query
// alone (no route is planned in a delve).

import { interiorColliderFrame, isBlocked } from '../src/sim/colliders';
import { DELVES, DUNGEONS, instanceOrigin, MOBS } from '../src/sim/data';
import { DAWNHOLD, DAWNHOLD_GATES } from '../src/sim/dawnhold_layout';
import { createMob } from '../src/sim/entity';
import {
  applyDungeonMobTuning,
  mobLevelForDungeonDifficulty,
  mobTemplateForDungeonDifficulty,
} from '../src/sim/instances/difficulty';
import { claimedInstanceAt } from '../src/sim/instances/dungeons';
import { SIGHT_QUERIES_PER_TICK } from '../src/sim/mob/cast_sight';
import {
  ROUTE_NODES_PER_PLAN,
  ROUTE_NODES_PER_TICK,
  routeSearchOpts,
} from '../src/sim/mob/chase_route';
import { searchRoute } from '../src/sim/mob/route_search';
import { Sim } from '../src/sim/sim';
import { addThreat } from '../src/sim/threat';
import type { Entity } from '../src/sim/types';
import { WORLD_SEED } from '../src/sim/world_seed';

interface Spot {
  x: number;
  z: number;
}

interface World {
  name: string;
  sim: Sim;
  player: Entity;
  /** World origin of the scene's local coordinates. */
  ox: number;
  oz: number;
  spawn(templateId: string, at: Spot): Entity;
  /** Single-plan cases: where the mob stands and where its target does. */
  plans: { name: string; from: Spot; to: Spot }[];
  /** The pack scene: where the casters stand, a spot in sight, a spot hidden. */
  pack: { casters: (i: number, n: number) => Spot; seen: Spot; hidden: Spot };
  /** The doorway dance: casters, and the two spots the target hops between. */
  dance: { casters: (i: number, n: number) => Spot; a: Spot; b: Spot };
  caster: string;
}

function place(w: World, e: Entity, at: Spot): void {
  e.pos = w.sim.ctx.groundPos(w.ox + at.x, w.oz + at.z);
  e.prevPos = { ...e.pos };
  w.sim.ctx.rebucket(e);
}

function engage(mob: Entity, victim: Entity): void {
  mob.aggroTargetId = victim.id;
  mob.inCombat = true;
  mob.aiState = 'chase';
  mob.leashAnchor = { ...mob.pos };
  addThreat(mob, victim.id, 100);
}

function openWorld(): World {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior', autoEquip: false });
  const player = sim.player;
  const gate = (DAWNHOLD_GATES.main.a0 + DAWNHOLD_GATES.main.a1) / 2;
  const wall = DAWNHOLD.wx1;
  const w: World = {
    name: 'open world (Dawnhold east wall)',
    sim,
    player,
    ox: 0,
    oz: 0,
    caster: 'corrupted_priest_malric',
    spawn(templateId, at) {
      const mob = createMob(sim.ctx.nextId++, MOBS[templateId], 10, sim.ctx.groundPos(at.x, at.z));
      mob.hostile = true;
      mob.maxHp = 1e7;
      mob.hp = 1e7;
      sim.ctx.addEntity(mob);
      return mob;
    },
    plans: [
      { name: 'clear line, 28 yd', from: { x: wall + 34, z: 905 }, to: { x: wall + 6, z: 905 } },
      {
        name: 'wall detour (gate 18 yd aside)',
        from: { x: wall + 8, z: gate + 18 },
        to: { x: wall - 8, z: gate + 18 },
      },
      {
        name: 'target on the wall line, 6 yd away',
        from: { x: wall + 6, z: gate + 18 },
        to: { x: wall, z: gate + 18 },
      },
      {
        name: 'widest window (perched)',
        from: { x: wall + 30, z: gate + 43 },
        to: { x: wall, z: gate + 12 },
      },
    ],
    pack: {
      casters: (i) => ({ x: wall + 10 + (i % 5) * 2.2, z: gate + 10 + Math.floor(i / 5) * 2.2 }),
      seen: { x: wall + 26, z: gate + 14 },
      hidden: { x: wall - 8, z: gate + 14 },
    },
    dance: {
      casters: (i) => ({ x: wall + 12 + (i % 5) * 2.2, z: gate + 6 + Math.floor(i / 5) * 2.2 }),
      a: { x: wall - 6, z: gate },
      b: { x: wall - 6, z: gate + 9 },
    },
  };
  player.maxHp = 1e9;
  player.hp = 1e9;
  return w;
}

function crypt(shutGate: boolean): World {
  const sim = new Sim({ seed: 23, playerClass: 'warrior', autoEquip: false, devCommands: true });
  const player = sim.player;
  sim.chat('/dev level 20', player.id);
  sim.chat('/dev crypt enter heroic', player.id);
  const inst = claimedInstanceAt(sim.ctx, player.pos);
  if (!inst) throw new Error('no crypt claim');
  for (const id of inst.mobIds) {
    const e = sim.ctx.entities.get(id);
    if (!e || e.dead) continue;
    if (shutGate && e.templateId === 'crypt_gravecaller_necromancer') continue;
    sim.ctx.handleDeath(e, player);
  }
  player.devNoAggro = true;
  player.maxHp = 1e9;
  player.hp = 1e9;
  const o = instanceOrigin(DUNGEONS.hollow_crypt.index, inst.slot);
  sim.tick();
  sim.drainEvents();
  return {
    name: shutGate ? 'Hollow Crypt (grille shut)' : 'Hollow Crypt (grille open)',
    sim,
    player,
    ox: o.x,
    oz: o.z,
    caster: 'crypt_gravecaller_adept',
    spawn(templateId, at) {
      const template = MOBS[templateId];
      const mob = createMob(
        sim.ctx.nextId++,
        mobTemplateForDungeonDifficulty(template, 'hollow_crypt', inst.difficulty),
        mobLevelForDungeonDifficulty('hollow_crypt', inst.difficulty, template.minLevel),
        sim.ctx.groundPos(o.x + at.x, o.z + at.z),
      );
      applyDungeonMobTuning(mob, 'hollow_crypt', inst.difficulty);
      mob.dungeonPackId = 'bench';
      mob.maxHp = 1e7;
      mob.hp = 1e7;
      sim.ctx.addEntity(mob);
      inst.mobIds.push(mob.id);
      return mob;
    },
    plans: [
      { name: 'clear line, 26 yd', from: { x: 13, z: -44 }, to: { x: 13, z: -18 } },
      { name: 'monument detour', from: { x: 0, z: -44 }, to: { x: 0, z: -18 } },
      {
        name: shutGate ? 'wall with its gate shut' : 'wall detour (gate 18 yd aside)',
        from: { x: 18, z: 30 },
        to: { x: 18, z: 12 },
      },
      { name: 'perched target 6 yd away', from: { x: 0, z: -38.5 }, to: { x: 0, z: -32 } },
      { name: 'widest window (perched)', from: { x: 30, z: -61 }, to: { x: 0, z: -30 } },
    ],
    pack: {
      casters: (i) => ({ x: 10 + (i % 5) * 2.2, z: 28 + Math.floor(i / 5) * 2.2 }),
      seen: { x: 16, z: 44 },
      hidden: { x: 18, z: 12 },
    },
    dance: {
      casters: (i) => ({ x: 9 + (i % 5) * 2.2, z: 27 + Math.floor(i / 5) * 2.2 }),
      a: { x: 3, z: 14 },
      b: { x: 14, z: 14 },
    },
  };
}

const ms = (n: number): string => n.toFixed(3).padStart(8);

/** min / median / max of a sample, formatted. */
function spread(times: number[]): string {
  times.sort((a, b) => a - b);
  return `${ms(times[0])} ${ms(times[times.length >> 1])} ${ms(times[times.length - 1])}`;
}

/** Time `fn` `n` times after `warm` unmeasured calls. */
function timed(fn: () => void, n: number, warm = 5): number[] {
  for (let i = 0; i < warm; i++) fn();
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  return times;
}

function benchPlans(w: World): void {
  const mob = w.spawn(w.caster, w.plans[0].from);
  console.log(
    `\n== ${w.name}: single searches, called directly (ms: min / median / max over 15) ==`,
  );
  for (const c of w.plans) {
    place(w, mob, c.from);
    place(w, w.player, c.to);
    const opts = routeSearchOpts(w.sim.ctx, mob);
    let result = searchRoute(mob.pos, w.player.pos, opts);
    const times = timed(() => {
      result = searchRoute(mob.pos, w.player.pos, opts);
    }, 15);
    // What the search itself answered, so no row's label has to be believed.
    const outcome = !result.attempted
      ? 'refused (window too wide)'
      : result.found
        ? `found, ${result.path.length} waypoint${result.path.length === 1 ? '' : 's'}`
        : result.nodes >= opts.maxNodes
          ? 'none (stopped at the cap)'
          : 'none (window flooded)';
    console.log(
      `  ${c.name.padEnd(40)} ${spread(times)}   cells judged ${String(result.nodes).padStart(3)}  ${outcome}`,
    );
  }
  w.sim.ctx.dropEntity(mob.id);
}

/**
 * The most a tick can spend, timed DIRECTLY (no whole-tick noise): the route
 * budget is one capped search plus whatever a second one fits in the cells
 * left, and the sight budget is SIGHT_QUERIES_PER_TICK queries. `from` must be
 * walkable and `to` a spot no route reaches, so both searches run to their
 * caps.
 */
function benchBudgets(
  label: string,
  sim: Sim,
  mob: Entity,
  target: Entity,
  cases: { name: string; from: Spot; to: Spot }[],
  put: (e: Entity, at: Spot) => void,
): void {
  console.log(
    `\n== ${label}: a tick's whole budget, timed directly (ms: min / median / max over 30) ==`,
  );
  for (const c of cases) {
    put(mob, c.from);
    put(target, c.to);
    const opts = routeSearchOpts(sim.ctx, mob);
    const rest = { ...opts, maxNodes: ROUTE_NODES_PER_TICK - ROUTE_NODES_PER_PLAN };
    let judged = 0;
    const route = timed(() => {
      judged =
        searchRoute(mob.pos, target.pos, opts).nodes + searchRoute(mob.pos, target.pos, rest).nodes;
    }, 30);
    let clear = 0;
    const sight = timed(() => {
      clear = 0;
      for (let i = 0; i < SIGHT_QUERIES_PER_TICK; i++) {
        if (sim.ctx.hasLineOfSight(mob, target)) clear++;
      }
    }, 30);
    const one = timed(
      () => {
        sim.ctx.hasLineOfSight(mob, target);
      },
      200,
      20,
    );
    const yards = Math.hypot(mob.pos.x - target.pos.x, mob.pos.z - target.pos.z).toFixed(0);
    console.log(`  ${c.name} (${yards} yd apart)`);
    console.log(
      `    route: the tick's ${ROUTE_NODES_PER_TICK} cells`.padEnd(46) +
        `${spread(route)}   cells judged ${judged}`,
    );
    console.log(
      `    sight: the tick's ${SIGHT_QUERIES_PER_TICK} queries`.padEnd(46) +
        `${spread(sight)}   clear ${clear} of ${SIGHT_QUERIES_PER_TICK}`,
    );
    console.log(`    sight: one query`.padEnd(46) + `${spread(one)}`);
  }
}

function benchCryptBudgets(): void {
  const w = crypt(true);
  const mob = w.spawn(w.caster, { x: 18, z: 30 });
  benchBudgets(
    w.name,
    w.sim,
    mob,
    w.player,
    [
      { name: 'across the shut grille', from: { x: 18, z: 30 }, to: { x: 18, z: 12 } },
      { name: 'the monument between them', from: { x: 0, z: -44 }, to: { x: 0, z: -18 } },
      { name: 'a clear line', from: { x: 13, z: -44 }, to: { x: 13, z: -18 } },
    ],
    (e, at) => place(w, e, at),
  );
}

/** The dungeon interior with the most colliders (its cell lists are the
 *  longest, so a judged cell and a sight sample cost the most there). */
function densestInterior(): { id: string; ox: number; oz: number; colliders: number } {
  let best = { id: '', ox: 0, oz: 0, colliders: -1 };
  for (const def of Object.values(DUNGEONS)) {
    // An unclaimed slot: every gate shut, the dungeon's whole collider set.
    const o = instanceOrigin(def.index, 9);
    const frame = interiorColliderFrame(o.x, o.z);
    if (frame && frame.list.length > best.colliders) {
      best = { id: def.id, ox: frame.ox, oz: frame.oz, colliders: frame.list.length };
    }
  }
  return best;
}

function benchDensestInterior(): void {
  const d = densestInterior();
  const sim = new Sim({ seed: 23, playerClass: 'warrior', autoEquip: false });
  const seed = sim.cfg.seed;
  const free = (x: number, z: number): boolean =>
    !isBlocked(seed, d.ox + x + 0.5, d.oz + z + 0.5, 0.5);
  // A floor cell with open floor round it, nearest the interior's origin, and
  // from it: a far floor cell in a straight clear line, and a cell deep inside
  // a collider (a perch no route reaches).
  let from: Spot | null = null;
  for (let ring = 0; ring < 120 && !from; ring++) {
    for (let x = -ring; x <= ring && !from; x++) {
      for (let z = -ring; z <= ring && !from; z++) {
        if (Math.max(Math.abs(x), Math.abs(z)) !== ring) continue;
        let open = 0;
        for (let dx = -3; dx <= 3; dx++)
          for (let dz = -3; dz <= 3; dz++) if (free(x + dx, z + dz)) open++;
        if (open === 49) from = { x: x + 0.5, z: z + 0.5 };
      }
    }
  }
  if (!from) throw new Error(`no open floor found in ${d.id}`);
  let perch: Spot | null = null;
  for (let ring = 6; ring < 40 && !perch; ring++) {
    for (let a = 0; a < 64 && !perch; a++) {
      const x = Math.floor(from.x + Math.cos((a / 64) * Math.PI * 2) * ring);
      const z = Math.floor(from.z + Math.sin((a / 64) * Math.PI * 2) * ring);
      let solid = 0;
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) if (!free(x + dx, z + dz)) solid++;
      if (solid === 9) perch = { x: x + 0.5, z: z + 0.5 };
    }
  }
  if (!perch) throw new Error(`no perch found in ${d.id}`);
  const mob = createMob(
    sim.ctx.nextId++,
    MOBS.crypt_gravecaller_adept,
    8,
    sim.ctx.groundPos(d.ox + from.x, d.oz + from.z),
  );
  sim.ctx.addEntity(mob);
  benchBudgets(
    `densest interior: ${d.id} (${d.colliders} colliders, gates shut, unclaimed slot)`,
    sim,
    mob,
    sim.player,
    [{ name: 'a target perched inside a collider', from, to: perch }],
    (e, at) => {
      e.pos = sim.ctx.groundPos(d.ox + at.x, d.oz + at.z);
      e.prevPos = { ...e.pos };
      sim.ctx.rebucket(e);
    },
  );
}

interface TickStats {
  worst: number;
  mean: number;
  plans: number;
  maxPlans: number;
  maxNodes: number;
  deferred: number;
  sight: number;
  maxSight: number;
}

/** Run a scene for `seconds`, moving the target with `move(tick)`. Best of
 *  three on the wall-time numbers (the counters are the same every run). */
function runScene(
  build: () => World,
  n: number,
  spots: (w: World) => (i: number, n: number) => Spot,
  move: (w: World, tick: number) => Spot,
  seconds: number,
): TickStats {
  let best: TickStats | null = null;
  for (let rep = 0; rep < 3; rep++) {
    const w = build();
    const at = spots(w);
    place(w, w.player, move(w, 0));
    for (let i = 0; i < n; i++) engage(w.spawn(w.caster, at(i, n)), w.player);
    const s: TickStats = {
      worst: 0,
      mean: 0,
      plans: 0,
      maxPlans: 0,
      maxNodes: 0,
      deferred: 0,
      sight: 0,
      maxSight: 0,
    };
    let total = 0;
    const ticks = seconds * 20;
    for (let t = 0; t < ticks; t++) {
      place(w, w.player, move(w, t));
      w.player.hp = w.player.maxHp;
      const t0 = performance.now();
      w.sim.tick();
      const dt = performance.now() - t0;
      // The first second pays for module and collider warm-up.
      if (t >= 20) {
        s.worst = Math.max(s.worst, dt);
        total += dt;
      }
      const c = w.sim.mobScanCounters;
      s.plans += c.routePlans;
      s.maxPlans = Math.max(s.maxPlans, c.routePlans);
      s.maxNodes = Math.max(s.maxNodes, c.routeNodes);
      s.deferred += c.routeDeferred;
      s.sight += c.sightQueries;
      s.maxSight = Math.max(s.maxSight, c.sightQueries);
    }
    s.mean = total / (ticks - 20);
    if (!best || s.worst < best.worst) best = s;
  }
  return best as TickStats;
}

function benchScenes(build: () => World): void {
  const name = build().name;
  console.log(
    `\n== ${name}: whole scenes (counters per tick are exact; the whole-tick ms is the entire sim tick, for reference only) ==`,
  );
  const row = (label: string, s: TickStats): void =>
    console.log(
      `  ${label.padEnd(44)} plans ${String(s.plans).padStart(3)}  max plans/tick ${s.maxPlans}  max cells/tick ${String(s.maxNodes).padStart(4)}  deferred ${String(s.deferred).padStart(3)}  sight queries ${String(s.sight).padStart(4)}  max sight/tick ${String(s.maxSight).padStart(2)}   whole tick worst ${ms(s.worst)} mean ${ms(s.mean)}`,
    );
  row(
    '20 casters, target in sight (reference)',
    runScene(
      build,
      20,
      (w) => w.pack.casters,
      (w) => w.pack.seen,
      15,
    ),
  );
  row(
    '20 casters, target steps out of sight',
    runScene(
      build,
      20,
      (w) => w.pack.casters,
      (w, t) => (t < 60 ? w.pack.seen : w.pack.hidden),
      15,
    ),
  );
  row(
    '10 casters, target still by the doorway',
    runScene(
      build,
      10,
      (w) => w.dance.casters,
      (w) => w.dance.a,
      20,
    ),
  );
  row(
    '10 casters, doorway dance (hop every 1.5 s)',
    runScene(
      build,
      10,
      (w) => w.dance.casters,
      (w, t) => (Math.floor(t / 30) % 2 === 0 ? w.dance.a : w.dance.b),
      20,
    ),
  );
}

/** A delve room: no route is planned there, so only the sight query is timed
 *  (it scans the run's module colliders with no broad phase, and looks the run
 *  up for every query). */
function benchDelveSight(): void {
  const sim = new Sim({ seed: 31, playerClass: 'warrior', autoEquip: true });
  const def = DELVES.collapsed_reliquary;
  sim.setPlayerLevel(def.minLevel);
  const player = sim.player;
  player.pos = sim.ctx.groundPos(def.doorPos.x, def.doorPos.z);
  player.prevPos = { ...player.pos };
  sim.ctx.rebucket(player);
  sim.enterDelve('collapsed_reliquary', 'normal');
  const run = sim.delveRunForPlayer(player.id);
  if (!run) throw new Error('no delve run');
  const template = MOBS.reedbound_acolyte;
  console.log(
    '\n== delve room (Collapsed Reliquary): a sight query (ms: min / median / max over 200) ==',
  );
  for (const dist of [6, 16, 26]) {
    const mob = createMob(sim.ctx.nextId++, template, template.minLevel, {
      x: player.pos.x + dist,
      y: player.pos.y,
      z: player.pos.z,
    });
    sim.ctx.addEntity(mob);
    run.mobIds.push(mob.id);
    let clear = false;
    const times = timed(
      () => {
        clear = sim.ctx.hasLineOfSight(mob, player);
      },
      200,
      20,
    );
    console.log(`  ${`${dist} yd`.padEnd(40)} ${spread(times)}   clear ${clear}`);
  }
}

benchPlans(openWorld());
benchPlans(crypt(false));
benchPlans(crypt(true));
benchCryptBudgets();
benchDensestInterior();
benchScenes(openWorld);
benchScenes(() => crypt(false));
benchDelveSight();
