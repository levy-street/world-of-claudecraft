import { describe, expect, it } from 'vitest';
import {
  turretPlanWireJson,
  turretStateWireJson,
  turretWireNumber,
} from '../server/turret_self_wire';
import {
  decodeTurretFeedback,
  decodeTurretPlan,
  decodeTurretSeat,
  type TurretSeatState,
} from '../src/net/turret_session_wire';
import {
  TURRET_SCENARIO_HARD,
  TURRET_SCENARIO_STANDARD,
  TURRET_SCENARIOS,
} from '../src/sim/content/fire_and_fly_scenarios';
import { TURRET_SHOCKWAVE } from '../src/sim/content/turret_defense';
import { BUILTIN_WORLD } from '../src/sim/data';
import { positionAt } from '../src/sim/minigames/thrown_body';
import type { TurretEvent } from '../src/sim/minigames/turret_defense';
import {
  resolveTurretPlan,
  TURRET_PLAN_LIMITS,
  turretChargesLeft,
} from '../src/sim/minigames/turret_defense_plan';
import { TURRET_BONUS_CAP, turretResult } from '../src/sim/minigames/turret_result';
import { Sim } from '../src/sim/sim';
import type { TurretSessionView } from '../src/sim/turret_defense_session';
import type { SimEvent, TurretSession, TurretWaveDef, WorldContent } from '../src/sim/types';
import { turretSessionFor } from '../src/sim/vehicles';
import { groundHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const ground = { ground: (x: number, z: number) => groundHeight(x, z, WORLD_SEED) };
const EMPTY_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };
const RUN_BOUND = 20 * 60 * 8;

type Wire = ReturnType<typeof JSON.parse>;

function wire(value: unknown): Wire {
  return JSON.parse(JSON.stringify(value));
}

/** A value as the `tur` key carries it: the rounding the server applies, both sides alike. */
function rounded(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, turretWireNumber));
}

function seatOf(view: TurretSessionView): TurretSeatState {
  const { feedback: _ring, ...seat } = view;
  return seat;
}

interface Run {
  /** Every distinct seat revision of the run, each with its `tur` JSON. */
  revisions: { view: TurretSessionView; json: string }[];
  events: Extract<SimEvent, { type: 'turretDefense' }>[];
  session: TurretSession;
}

/**
 * A whole seat on the server, aimed at the monster nearest the tower, or left to breach;
 * armed, it fires its frag shells first and slams whenever a body stands inside the reach.
 */
function playRun(aim: boolean, armed = false): Run {
  const sim = new Sim({
    seed: WORLD_SEED,
    playerClass: 'warrior',
    devCommands: true,
    noPlayer: true,
    world: EMPTY_WORLD,
  });
  const pid = sim.addPlayer('warrior', 'Gunner', { characterId: 7 });
  sim.chat('/dev turret', pid);
  const session = sim.meta(pid)!.vehicle as TurretSession;
  const run: Run = { revisions: [], events: [], session };
  let rev = -1;
  for (let i = 0; i < RUN_BOUND; i++) {
    for (const e of sim.tick()) if (e.type === 'turretDefense') run.events.push(e);
    const view = turretSessionFor(sim.ctx, pid)!;
    if (view.defense.rev !== rev) {
      rev = view.defense.rev;
      run.revisions.push({ view, json: turretStateWireJson(session, sim.tickCount) });
    }
    if (view.defense.phase === 'won' || view.defense.phase === 'lost') break;
    if (armed && inReach(view, sim.tickCount)) {
      sim.useVehicleAction('turret_shockwave', { x: 0, z: 0 }, pid);
    }
    if (!aim || sim.tickCount < view.defense.readyTick) continue;
    let best: { x: number; z: number } | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const m of view.defense.monsters) {
      if (m.hp <= 0) continue;
      const p = positionAt(m.seg, sim.tickCount, ground);
      const d = Math.hypot(p.x - view.defense.cx, p.z - view.defense.cz);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best && !(armed && sim.useVehicleAction('turret_frag', best, pid))) {
      sim.useVehicleAction('turret_fire', best, pid);
    }
  }
  return run;
}

function inReach(view: TurretSessionView, tick: number): boolean {
  return view.defense.monsters.some((m) => {
    if (m.hp <= 0) return false;
    const p = positionAt(m.seg, tick, ground);
    return Math.hypot(p.x - view.defense.cx, p.z - view.defense.cz) < TURRET_SHOCKWAVE.reach;
  });
}

const won = playRun(true);
const lost = playRun(false);
const armed = playRun(true, true);
const plan = decodeTurretPlan(JSON.parse(turretPlanWireJson(won.session.defense.plan)))!;

/** A mid-wave revision with bodies in flight, on the ground and marching, and barrels standing. */
function midWave(): TurretSessionView {
  const found = won.revisions.find(({ view }) => {
    const states = new Set(view.defense.monsters.map((m) => m.state));
    return (
      view.defense.phase === 'wave' &&
      view.defense.barrels.length > 0 &&
      states.has('fly') &&
      states.has('march') &&
      view.defense.shots.length > 0
    );
  });
  expect(found).toBeDefined();
  return found!.view;
}

describe('the turret plan key', () => {
  it('round-trips the resolved plan by value, deep-frozen like the sim', () => {
    const decoded = decodeTurretPlan(wire(resolveTurretPlan()));
    expect(decoded).toEqual(resolveTurretPlan());
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded!.kinds[0])).toBe(true);
    expect(Object.isFrozen(decoded!.waves[0].spawns)).toBe(true);
  });

  it.each(TURRET_SCENARIOS.map((s) => [s.boardKey, s] as const))(
    'round-trips the %s plan, its scenario, tower points, arsenal and arrivals',
    (_key, scenario) => {
      const resolved = resolveTurretPlan(scenario);
      const decoded = decodeTurretPlan(JSON.parse(turretPlanWireJson(resolved)));
      expect(decoded).toEqual(resolved);
      expect(decoded?.scenarioId).toBe(scenario.id);
      expect(decoded?.integrity).toBe(scenario.integrity);
      expect(decoded?.arsenal).toEqual({ shockwave: 2, fragmentation: 3 });
      expect(decoded?.waves.map((w) => w.arrival)).toEqual(
        scenario.waves.map((w) => w.arrival ?? { kind: 'ring' }),
      );
      expect(Object.isFrozen(decoded!.waves[0].arrival)).toBe(true);
    },
  );

  it('decodes a plan the resolver builds at every one of its limits', () => {
    const L = TURRET_PLAN_LIMITS;
    const wolf = { templateId: 'forest_wolf', count: 1, level: 2 };
    const wave = (entries: TurretWaveDef['entries'], arrival?: TurretWaveDef['arrival']) => ({
      entries,
      coreDamage: 60,
      gapMinTicks: 16,
      gapMaxTicks: 32,
      barrels: { count: 0, minRadius: 0, maxRadius: 0 },
      ...(arrival ? { arrival } : {}),
    });
    const kinds = Array.from({ length: L.kinds }, (_, i) => ({ ...wolf, hpScale: 1 + i / 100 }));
    const crowd = { ...wolf, count: L.spawnsPerWave };
    const pack = {
      kind: 'burst',
      groupSize: L.spawnsPerWave,
      groupGapTicks: L.groupGapTicks,
      widthTurn: 1,
    } as const;
    const resolved = resolveTurretPlan({
      ...TURRET_SCENARIO_STANDARD,
      id: 'z'.repeat(L.scenarioIdLength),
      integrity: L.integrity,
      arsenal: { shockwave: L.charges, fragmentation: L.charges },
      waves: [
        wave(kinds),
        wave([crowd], pack),
        ...Array.from({ length: L.waves - 2 }, () => wave([wolf])),
      ],
    });
    expect(resolved.kinds).toHaveLength(L.kinds);
    expect(resolved.waves).toHaveLength(L.waves);
    expect(resolved.waves[1].spawns).toHaveLength(L.spawnsPerWave);
    expect(decodeTurretPlan(JSON.parse(turretPlanWireJson(resolved)))).toEqual(resolved);
  });

  it('carries the scenario a seat was taken for, charges included', () => {
    const sim = new Sim({
      seed: WORLD_SEED,
      playerClass: 'warrior',
      devCommands: true,
      noPlayer: true,
      world: EMPTY_WORLD,
    });
    const pid = sim.addPlayer('warrior', 'Gunner', { characterId: 9 });
    sim.chat('/dev turret hard', pid);
    const session = sim.meta(pid)!.vehicle as TurretSession;
    const decoded = decodeTurretPlan(JSON.parse(turretPlanWireJson(session.defense.plan)))!;
    expect(decoded).toEqual(session.defense.plan);
    expect(decoded.scenarioId).toBe(TURRET_SCENARIO_HARD.id);
    const armed = resolveTurretPlan({ ...TURRET_SCENARIO_HARD, arsenal: { fragmentation: 4 } });
    expect(decodeTurretPlan(wire(armed))?.arsenal).toEqual({ shockwave: 0, fragmentation: 4 });
  });

  it.each([
    ['an unknown arrival', (p: Wire) => (p.waves[0].arrival = { kind: 'spiral' })],
    ['a missing arrival', (p: Wire) => delete p.waves[0].arrival],
    [
      'four flanks',
      (p: Wire) => (p.waves[1].arrival = { kind: 'flanks', count: 4, widthTurn: 0.1 }),
    ],
    ['an empty arc', (p: Wire) => (p.waves[0].arrival = { kind: 'arc', widthTurn: 0 })],
    [
      'an arc past a full turn',
      (p: Wire) => (p.waves[0].arrival = { kind: 'arc', widthTurn: 1.01 }),
    ],
    [
      'an empty pack',
      (p: Wire) =>
        (p.waves[0].arrival = { kind: 'burst', groupSize: 0, groupGapTicks: 20, widthTurn: 0.1 }),
    ],
    [
      'a fractional pause',
      (p: Wire) =>
        (p.waves[0].arrival = { kind: 'burst', groupSize: 2, groupGapTicks: 1.5, widthTurn: 0.1 }),
    ],
    [
      'an endless pause',
      (p: Wire) =>
        (p.waves[0].arrival = { kind: 'burst', groupSize: 2, groupGapTicks: 1e6, widthTurn: 0.1 }),
    ],
    ['no tower points', (p: Wire) => (p.integrity = 0)],
    ['fractional tower points', (p: Wire) => (p.integrity = 99.5)],
    ['a missing scenario', (p: Wire) => delete p.scenarioId],
    ['a scenario id out of its alphabet', (p: Wire) => (p.scenarioId = 'Hard <b>')],
    ['an oversized scenario id', (p: Wire) => (p.scenarioId = 'x'.repeat(65))],
    ['a missing arsenal', (p: Wire) => delete p.arsenal],
    ['negative charges', (p: Wire) => (p.arsenal.shockwave = -1)],
    ['too many charges', (p: Wire) => (p.arsenal.fragmentation = 100)],
    ['missing medal bars', (p: Wire) => delete p.medals],
    ['a missing silver bar', (p: Wire) => delete p.medals.silver],
    [
      'a silver bar at gold',
      (p: Wire) => (p.medals.silver.minIntegrityShare = p.medals.gold.minIntegrityShare),
    ],
    ['a gold bar past the whole tower', (p: Wire) => (p.medals.gold.minIntegrityShare = 1.2)],
    ['a silver bar at nothing', (p: Wire) => (p.medals.silver.minIntegrityShare = 0)],
    ['a string bar', (p: Wire) => (p.medals.gold.minIntegrityShare = '0.9')],
    [
      'bars that round to one tower point',
      (p: Wire) => {
        p.integrity = 10;
        p.medals.gold.minIntegrityShare = 0.95;
        p.medals.silver.minIntegrityShare = 0.91;
      },
    ],
    ["a silver bar at a win's last point", (p: Wire) => (p.medals.silver.minIntegrityShare = 0.01)],
  ])('rejects %s', (_, forge) => {
    const forged = wire(resolveTurretPlan(TURRET_SCENARIO_HARD));
    forge(forged);
    expect(decodeTurretPlan(forged)).toBeNull();
  });

  it.each([
    ['an unknown size class', (p: Wire) => (p.kinds[0].sizeClass = 'tiny')],
    ['a spawn past the kinds', (p: Wire) => (p.waves[0].spawns[0] = p.kinds.length)],
    ['no wave', (p: Wire) => (p.waves = [])],
    ['a weightless kind', (p: Wire) => (p.kinds[0].mass = 0)],
    ['an empty template id', (p: Wire) => (p.kinds[0].templateId = '')],
    ['an oversized template id', (p: Wire) => (p.kinds[0].templateId = 'x'.repeat(65))],
    ['a missing bowling rule', (p: Wire) => delete p.bowling.enabled],
    ['a non-finite gap', (p: Wire) => (p.waves[0].gapMinTicks = Number.POSITIVE_INFINITY)],
    ['oversized kinds', (p: Wire) => (p.kinds = Array.from({ length: 65 }, () => p.kinds[0]))],
  ])('rejects %s', (_, forge) => {
    const forged = wire(resolveTurretPlan());
    forge(forged);
    expect(decodeTurretPlan(forged)).toBeNull();
  });

  it('reads null as no plan', () => {
    expect(decodeTurretPlan(null)).toBeNull();
  });
});

describe('the turret seat key', () => {
  it('round-trips every revision of a won and a lost run within the wire rounding, joined to its plan', () => {
    const states = new Set<string>();
    const segments = new Set<string>();
    for (const { view, json } of [...won.revisions, ...lost.revisions]) {
      const decoded = decodeTurretSeat(JSON.parse(json), plan);
      expect(rounded(decoded)).toEqual(rounded(seatOf(view)));
      expect(decoded!.defense.plan).toBe(plan);
      for (const m of view.defense.monsters) {
        states.add(m.state);
        segments.add(m.seg.kind);
      }
    }
    expect([...segments].sort()).toEqual(['fly', 'march', 'skid', 'still']);
    for (const state of ['march', 'windup', 'fly', 'skid', 'down', 'rise', 'dead'])
      expect(states).toContain(state);
    expect(won.revisions.at(-1)!.view.defense.phase).toBe('won');
    expect(lost.revisions.at(-1)!.view.defense.phase).toBe('lost');
  });

  it('round-trips every revision of a run that spends its limited weapons, its charges left alike', () => {
    const armedPlan = decodeTurretPlan(JSON.parse(turretPlanWireJson(armed.session.defense.plan)))!;
    let fragInFlight = false;
    let slamSpent = false;
    for (const { view, json } of armed.revisions) {
      const decoded = decodeTurretSeat(JSON.parse(json), armedPlan);
      expect(rounded(decoded)).toEqual(rounded(seatOf(view)));
      expect(turretChargesLeft(decoded!.defense)).toEqual(turretChargesLeft(view.defense));
      if (view.defense.shots.some((shot) => shot.weapon === 'frag')) fragInFlight = true;
      if (view.defense.phase === 'wave' && view.defense.stats.shockwaves > 0) slamSpent = true;
    }
    expect(fragInFlight).toBe(true);
    expect(slamSpent).toBe(true);
    const spent = armed.revisions.at(-1)!.view.defense.stats;
    expect(spent.frags).toBe(armedPlan.arsenal.fragmentation);
    expect(spent.shockwaves).toBeGreaterThan(0);
  });

  it("carries no result while the run lasts and the sim's own result once it ends", () => {
    for (const run of [won, lost]) {
      const last = run.revisions.at(-1)!;
      for (const { view, json } of run.revisions.slice(0, -1)) {
        expect(view.defense).not.toHaveProperty('result');
        expect(json).not.toContain('"result"');
        // Absent as the offline view leaves it, never an own key holding undefined.
        const keys = Object.keys(decodeTurretSeat(JSON.parse(json), plan)!.defense);
        expect(keys.sort()).toEqual(Object.keys(view.defense).sort());
      }
      const result = decodeTurretSeat(JSON.parse(last.json), plan)!.defense.result;
      expect(result).toEqual(run.session.defense.result);
      expect(result).toEqual(turretResult(plan, run.session.defense));
    }
    expect(won.session.defense.result?.medal).not.toBeNull();
    expect(lost.session.defense.result).toMatchObject({ won: false, medal: null });
  });

  it('decodes a copy the caller cannot reach the sim through', () => {
    const view = midWave();
    const decoded = decodeTurretSeat(wire(seatOf(view)), plan)!;
    expect(decoded).toEqual(seatOf(view));
    expect(decoded.defense.monsters[0]).not.toBe(view.defense.monsters[0]);
  });

  it('drops a field a newer server adds rather than rejecting the seat', () => {
    const forged = wire(seatOf(midWave()));
    forged.defense.monsters[0].tint = 'red';
    forged.later = 1;
    const decoded = decodeTurretSeat(forged, plan)!;
    expect(decoded.defense.monsters[0]).not.toHaveProperty('tint');
    expect(decoded).not.toHaveProperty('later');
  });

  it("drops the engine bookkeeping an older server's seat still carries", () => {
    const forged = wire(seatOf(midWave()));
    Object.assign(forged.defense, { spawnCursor: 2, nextShotId: 9, nextBarrelId: 3 });
    Object.assign(forged.defense.monsters[0], { airSince: -1, throwOpen: false, knocked: [] });
    const decoded = decodeTurretSeat(forged, plan)!;
    expect(decoded).toEqual(seatOf(midWave()));
    expect(decoded.defense).not.toHaveProperty('nextShotId');
    expect(decoded.defense.monsters[0]).not.toHaveProperty('knocked');
  });

  it.each([
    ['an unknown phase', (s: Wire) => (s.defense.phase = 'paused')],
    ['an unknown monster state', (s: Wire) => (s.defense.monsters[0].state = 'asleep')],
    ['an unknown segment kind', (s: Wire) => (s.defense.monsters[0].seg.kind = 'teleport')],
    [
      'an unknown flight contact',
      (s: Wire) => {
        const flyer = s.defense.monsters.find((m: Wire) => m.seg.kind === 'fly');
        flyer.seg.contact = 'lava';
      },
    ],
    ['a string coordinate', (s: Wire) => (s.defense.monsters[0].seg.x = '12')],
    ['a null coordinate', (s: Wire) => (s.origin.y = null)],
    ['a non-finite number', (s: Wire) => (s.defense.aimX = Number.NaN)],
    ['a runaway number', (s: Wire) => (s.defense.cx = 1e12)],
    ['a missing field', (s: Wire) => delete s.defense.monsters[0].facing],
    ['a fractional id', (s: Wire) => (s.defense.monsters[0].id = 1.5)],
    ['a negative revision', (s: Wire) => (s.defense.rev = -1)],
    ['a kind past the plan', (s: Wire) => (s.defense.monsters[0].kind = plan.kinds.length)],
    ['a wave past the plan', (s: Wire) => (s.defense.wave = plan.waves.length)],
    ['a wave count off the plan', (s: Wire) => (s.waveCount = plan.waves.length + 1)],
    ['a list where a record goes', (s: Wire) => (s.defense.stats = [])],
    [
      'oversized monsters',
      (s: Wire) => (s.defense.monsters = Array.from({ length: 257 }, () => s.defense.monsters[0])),
    ],
    [
      'oversized barrels',
      (s: Wire) => (s.defense.barrels = Array.from({ length: 65 }, () => s.defense.barrels[0])),
    ],
    ['a negative shot id', (s: Wire) => (s.defense.shots[0].id = -1)],
  ])('rejects the whole seat for %s', (_, forge) => {
    const forged = wire(seatOf(midWave()));
    forge(forged);
    expect(decodeTurretSeat(forged, plan)).toBeNull();
  });

  it.each([
    ['an ended seat with no result', (s: Wire) => delete s.defense.result],
    ['a null result', (s: Wire) => (s.defense.result = null)],
    ['a result the phase contradicts', (s: Wire) => (s.defense.result.won = false)],
    ['a result on a running seat', (s: Wire) => (s.defense.phase = 'wave')],
    ['an unknown medal', (s: Wire) => (s.defense.result.medal = 'platinum')],
    ['a win with no medal', (s: Wire) => (s.defense.result.medal = null)],
    ['points off their terms', (s: Wire) => s.defense.result.points++],
    ['fractional points', (s: Wire) => (s.defense.result.breakdown.kills += 0.5)],
    ['a negative term', (s: Wire) => (s.defense.result.breakdown.bowled = -1)],
    [
      'a bonus past its cap',
      (s: Wire) => {
        const b = s.defense.result.breakdown;
        b.kegKills = TURRET_BONUS_CAP;
        b.bowled = 1;
        s.defense.result.points = b.kills + b.integrity + b.kegKills + b.bowled;
      },
    ],
    ['runaway points', (s: Wire) => (s.defense.result.points = 1e12)],
  ])('rejects the whole seat for %s', (_, forge) => {
    const forged = wire(seatOf(won.revisions.at(-1)!.view));
    expect(decodeTurretSeat(wire(forged), plan)).not.toBeNull();
    forge(forged);
    expect(decodeTurretSeat(forged, plan)).toBeNull();
  });

  it('rejects a lost seat whose result holds a medal, or a running one with a result', () => {
    const forged = wire(seatOf(lost.revisions.at(-1)!.view));
    expect(decodeTurretSeat(wire(forged), plan)).not.toBeNull();
    forged.defense.result.medal = 'bronze';
    expect(decodeTurretSeat(forged, plan)).toBeNull();
    const running = wire(seatOf(lost.revisions.at(-1)!.view));
    running.defense.phase = 'between';
    expect(decodeTurretSeat(running, plan)).toBeNull();
  });

  it('reads null as no seat', () => {
    expect(decodeTurretSeat(null, plan)).toBeNull();
  });
});

describe('the turretDefense event', () => {
  // The two the scripted runs never produce: a body landing in water, one thrown off the world.
  const sample: TurretEvent[] = [
    { type: 'splash', id: 4, x: 1, y: 0.5, z: 2 },
    { type: 'vanished', id: 5, x: 3, y: 0.25, z: -2 },
  ];

  it('round-trips every event of a won and a lost run as its ring entry, deep-frozen', () => {
    const types = new Set<string>();
    for (const e of [...won.events, ...lost.events]) {
      const decoded = decodeTurretFeedback(wire(e));
      expect(decoded).toEqual({ seq: e.seq, tick: e.tick, event: e.event });
      expect(Object.isFrozen(decoded!.event)).toBe(true);
      types.add(e.event.type);
    }
    for (const event of sample) {
      expect(decodeTurretFeedback({ seq: 1, tick: 0, event })?.event).toEqual(event);
      types.add(event.type);
    }
    expect([...types].sort()).toEqual(
      [
        'fired',
        'impact',
        'launched',
        'bounce',
        'landed',
        'bowled',
        'splash',
        'killed',
        'windupStart',
        'breach',
        'vanished',
        'waveStart',
        'barrelsPlaced',
        'barrelLit',
        'barrelExploded',
        'waveCleared',
        'ended',
      ].sort(),
    );
  });

  it("round-trips the limited weapons' entries: the frag's shot, burst and bomblets, the slam and its hits", () => {
    const types = new Set<string>();
    for (const e of armed.events) {
      expect(decodeTurretFeedback(wire(e))).toEqual({ seq: e.seq, tick: e.tick, event: e.event });
      types.add(e.event.type === 'fired' && e.event.weapon ? 'fired frag' : e.event.type);
    }
    for (const type of ['fired frag', 'fragBurst', 'bomblet', 'shockwave', 'shockwaveHit']) {
      expect(types.has(type), type).toBe(true);
    }
  });

  const entry = (type: TurretEvent['type']): Wire =>
    wire(armed.events.find((e) => e.event.type === type));

  it.each([
    [
      'a frag burst with a seventh bomblet',
      'fragBurst',
      (e: Wire) => e.event.bomblets.push(e.event.bomblets[0]),
    ],
    ['a shell kind the wire does not know', 'fired', (e: Wire) => (e.event.weapon = 'shell')],
    ['a negative Shockwave reach', 'shockwave', (e: Wire) => (e.event.reach = -1)],
    ['a fractional bomblet index', 'bomblet', (e: Wire) => (e.event.index = 1.5)],
  ] as [string, TurretEvent['type'], (e: Wire) => unknown][])('rejects %s', (_, type, forge) => {
    const forged = entry(type);
    expect(decodeTurretFeedback(wire(forged))).not.toBeNull();
    forge(forged);
    expect(decodeTurretFeedback(forged)).toBeNull();
  });

  const fired = (): Wire => wire(won.events.find((e) => e.event.type === 'fired'));
  const impact = (): Wire => wire(won.events.find((e) => e.event.type === 'impact'));

  it.each([
    ['an unknown event type', (e: Wire) => (e.event.type = 'nuke')],
    ['a missing event', (e: Wire) => delete e.event],
    ['a sequence of 0', (e: Wire) => (e.seq = 0)],
    ['a negative tick', (e: Wire) => (e.tick = -1)],
    ['a fractional sequence', (e: Wire) => (e.seq = 2.5)],
    ['a string field', (e: Wire) => (e.event.shotId = '3')],
    ['a missing field', (e: Wire) => delete e.event.impactTick],
  ])('rejects %s', (_, forge) => {
    const forged = fired();
    forge(forged);
    expect(decodeTurretFeedback(forged)).toBeNull();
  });

  it('rejects oversized hits and unknown bounce surfaces or results', () => {
    const blast = impact();
    blast.event.hits = Array.from({ length: 257 }, () => ({
      id: 1,
      falloff: 1,
      damage: 1,
      x: 0,
      y: 0,
      z: 0,
    }));
    expect(decodeTurretFeedback(blast)).toBeNull();
    const bounce = { seq: 1, tick: 0, event: { type: 'bounce', id: 1, x: 0, y: 0, z: 0 } };
    expect(
      decodeTurretFeedback({ ...bounce, event: { ...bounce.event, surface: 'lava', speed: 1 } }),
    ).toBeNull();
    const ended = wire(won.events.find((e) => e.event.type === 'ended'));
    ended.event.result = 'draw';
    expect(decodeTurretFeedback(ended)).toBeNull();
  });

  it("carries the run's medal and points on its end entry", () => {
    for (const run of [won, lost]) {
      const end = run.events.find((e) => e.event.type === 'ended')!;
      const result = run.session.defense.result!;
      expect(decodeTurretFeedback(wire(end))?.event).toMatchObject({
        result: result.won ? 'won' : 'lost',
        medal: result.medal,
        points: result.points,
        breakdown: result.breakdown,
      });
    }
  });

  it.each([
    ['an unknown medal', (e: Wire) => (e.event.medal = 'platinum')],
    ['a win with no medal', (e: Wire) => (e.event.medal = null)],
    ['a loss with a medal', (e: Wire) => (e.event.result = 'lost')],
    ['points off their terms', (e: Wire) => (e.event.points += 1)],
    ['a missing breakdown', (e: Wire) => delete e.event.breakdown],
    ['a fractional term', (e: Wire) => (e.event.breakdown.integrity += 0.5)],
    ['a keg bonus past its cap', (e: Wire) => (e.event.breakdown.kegKills = TURRET_BONUS_CAP + 1)],
  ])('rejects an end entry with %s', (_, forge) => {
    const ended = wire(won.events.find((e) => e.event.type === 'ended'));
    expect(decodeTurretFeedback(wire(ended))).not.toBeNull();
    forge(ended);
    expect(decodeTurretFeedback(ended)).toBeNull();
  });
});
