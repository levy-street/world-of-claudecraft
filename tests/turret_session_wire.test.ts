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
import { BUILTIN_WORLD } from '../src/sim/data';
import { positionAt } from '../src/sim/minigames/thrown_body';
import type { TurretEvent } from '../src/sim/minigames/turret_defense';
import { resolveTurretPlan } from '../src/sim/minigames/turret_defense_plan';
import { Sim } from '../src/sim/sim';
import type { TurretSessionView } from '../src/sim/turret_defense_session';
import type { SimEvent, TurretSession, WorldContent } from '../src/sim/types';
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

/** A whole seat on the server, aimed at the monster nearest the tower, or left to breach. */
function playRun(aim: boolean): Run {
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
    if (best) sim.useVehicleAction('turret_fire', best, pid);
  }
  return run;
}

const won = playRun(true);
const lost = playRun(false);
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
});
