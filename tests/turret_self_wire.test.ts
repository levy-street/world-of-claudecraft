import { describe, expect, it } from 'vitest';
import {
  emitTurretSelfKeys,
  turretPlanWireJson,
  turretStateWireJson,
  turretWireNumber,
} from '../server/turret_self_wire';
import { TURRET_ARENA } from '../src/sim/content/turret_defense';
import { BUILTIN_WORLD } from '../src/sim/data';
import {
  horizontalAt,
  type MarchSegment,
  marchSegment,
  positionAt,
} from '../src/sim/minigames/thrown_body';
import { Sim } from '../src/sim/sim';
import type { TurretSession, WorldContent } from '../src/sim/types';
import { turretSessionFor } from '../src/sim/vehicles';
import { groundHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const ground = { ground: (x: number, z: number) => groundHeight(x, z, WORLD_SEED) };
const DRIFT_BOUND_YD = 0.005;
const FINE_KEYS = ['dx', 'dz', 'speed'];
const EMPTY_WORLD: WorldContent = { ...BUILTIN_WORLD, camps: [], npcs: {}, groundObjects: [] };

function seated() {
  const sim = new Sim({
    seed: WORLD_SEED,
    playerClass: 'warrior',
    devCommands: true,
    noPlayer: true,
    world: EMPTY_WORLD,
  });
  const pid = sim.addPlayer('warrior', 'Gunner', { characterId: 7 });
  sim.chat('/dev turret', pid);
  const meta = sim.meta(pid)!;
  return { sim, pid, meta, session: meta.vehicle as TurretSession };
}

function rounded(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, turretWireNumber));
}

/** Every number of a plain value with the key it sits under, in serialization order. */
function numbersIn(value: unknown, key = '', out: [string, number][] = []): [string, number][] {
  if (typeof value === 'number') out.push([key, value]);
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) numbersIn(v, k, out);
  return out;
}

function keys(meta: Parameters<typeof emitTurretSelfKeys>[1], tick = 0): [string, string][] {
  const out: [string, string][] = [];
  emitTurretSelfKeys((key, serialized) => out.push([key, serialized]), meta, tick);
  return out;
}

describe('the turret self keys', () => {
  it('emits explicit nulls off the seat, plan first', () => {
    expect(keys({ vehicle: null })).toEqual([
      ['turp', 'null'],
      ['tur', 'null'],
    ]);
  });

  it('carries the view minus the feedback ring and the plan, which rides alone', () => {
    const { sim, pid, meta, session } = seated();
    for (let i = 0; i < 200; i++) sim.tick();
    const [[planKey, planJson], [stateKey, stateJson]] = keys(meta, sim.tickCount);
    expect([planKey, stateKey]).toEqual(['turp', 'tur']);
    const { feedback, defense, ...view } = turretSessionFor(sim.ctx, pid)!;
    expect(feedback.length).toBeGreaterThan(0);
    const { plan, ...state } = defense;
    expect(JSON.parse(stateJson)).toEqual(rounded({ ...view, defense: state }));
    expect(JSON.parse(planJson)).toEqual(plan);
    const wire = JSON.parse(stateJson);
    expect(wire).not.toHaveProperty('feedback');
    const cursors = ['spawnCursor', 'nextSpawnTick', 'nextShotId', 'nextMonsterId', 'nextBarrelId'];
    for (const key of ['plan', 'seed', 'tick', ...cursors])
      expect(wire.defense).not.toHaveProperty(key);
    expect(wire.defense.monsters.length).toBeGreaterThan(0);
    for (const m of wire.defense.monsters) {
      for (const key of ['airSince', 'throwX', 'throwZ', 'throwOpen', 'knocked'])
        expect(m).not.toHaveProperty(key);
      expect(Number.isInteger(m.maxHp)).toBe(true);
    }
    expect(session.defense.plan).toBe(plan);
  });

  it('rounds the state to 3 decimals, a march to 5, integers exact, the plan exact', () => {
    expect(turretWireNumber('x', 12.34567)).toBe(12.346);
    expect(turretWireNumber('x', 0.0004)).toBe(0);
    expect(turretWireNumber('dx', 0.7071067)).toBe(0.70711);
    expect(turretWireNumber('speed', 3.9875)).toBe(3.9875);
    expect(turretWireNumber('id', 123456789)).toBe(123456789);
    expect(turretWireNumber('tick', -1)).toBe(-1);
    expect(turretWireNumber('state', 'fly')).toBe('fly');

    const { sim, pid, meta, session } = seated();
    const moving = (kind: string) => session.defense.monsters.some((m) => m.seg.kind === kind);
    for (let i = 0; i < 1200 && !(moving('fly') && moving('march')); i++) {
      sim.tick();
      const defense = session.defense;
      const target = defense.monsters.find((m) => m.hp > 0);
      if (defense.phase === 'wave' && sim.tickCount >= defense.readyTick && target)
        sim.useVehicleAction('turret_fire', positionAt(target.seg, sim.tickCount, ground), pid);
    }
    expect(moving('fly') && moving('march')).toBe(true);
    const [[, planJson], [, stateJson]] = keys(meta, sim.tickCount);
    const wire = JSON.parse(stateJson);
    const onWire = numbersIn({ ...wire, defense: { ...wire.defense, stats: {} } });
    expect(onWire.some(([key, n]) => key === 'dx' && !Number.isInteger(n))).toBe(true);
    for (const [key, n] of onWire) {
      const scale = FINE_KEYS.includes(key) ? 1e5 : 1e3;
      expect(Math.round(n * scale) / scale).toBe(n);
    }
    const exact = numbersIn(turretSessionFor(sim.ctx, pid)!.defense.monsters);
    const shown = numbersIn(JSON.parse(stateJson).defense.monsters);
    expect(shown.map(([key]) => key)).toEqual(exact.map(([key]) => key));
    for (const [i, [, n]] of exact.entries()) {
      if (Number.isInteger(n)) expect(shown[i][1]).toBe(n);
      else expect(Math.abs(shown[i][1] - n)).toBeLessThanOrEqual(5e-4 + 1e-9);
    }
    expect(planJson).toBe(JSON.stringify(session.defense.plan));
  });

  it('holds a slow march on an unround speed to the millimetre across the spawn radius', () => {
    const reach = TURRET_ARENA.spawnRadius;
    const dir = { x: 3 / Math.hypot(3, 7), z: 7 / Math.hypot(3, 7) };
    const exact = marchSegment(120, 1.2345, 0, -3.21, dir.x * reach, dir.z * reach, 2.0625, 0);
    const shown = rounded(exact) as MarchSegment;
    const a = horizontalAt(shown, exact.end);
    const b = horizontalAt(exact, exact.end);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(DRIFT_BOUND_YD);
  });

  it('keeps the result card stats exact, since it rounds them itself', () => {
    const { sim, session } = seated();
    Object.assign(session.defense.stats, { longestThrow: 12.3496, longestAirtime: 2.34951 });
    session.defense.rev++;
    const wire = JSON.parse(turretStateWireJson(session, sim.tickCount));
    expect(wire.defense.stats.longestThrow).toBe(12.3496);
    expect(wire.defense.stats.longestAirtime).toBe(2.34951);
  });

  it('serializes once per engine revision and once per plan, whatever the clock does', () => {
    const { sim, session } = seated();
    const state = turretStateWireJson(session, sim.tickCount);
    const plan = turretPlanWireJson(session.defense.plan);
    let rev = session.defense.rev;
    let quiet = 0;
    let moved = 0;
    let json = state;
    for (let i = 0; i < 400; i++) {
      sim.tick();
      const next = turretStateWireJson(session, sim.tickCount);
      if (session.defense.rev === rev) {
        expect(next).toBe(json);
        quiet++;
      } else {
        expect(next).not.toBe(json);
        rev = session.defense.rev;
        moved++;
      }
      json = next;
      expect(turretPlanWireJson(session.defense.plan)).toBe(plan);
    }
    expect(quiet).toBeGreaterThan(0);
    expect(moved).toBeGreaterThan(0);
  });

  it('holds a shot fired between ticks until a tick has routed its fired entry', () => {
    const { sim, pid, session } = seated();
    let json = '';
    for (let i = 0; i < 400; i++) {
      sim.tick();
      json = turretStateWireJson(session, sim.tickCount);
      const defense = session.defense;
      if (defense.phase === 'wave' && sim.tickCount >= defense.readyTick) break;
    }
    const shots = session.defense.stats.shots;
    const aim = { x: session.defense.cx + 20, z: session.defense.cz };
    expect(sim.useVehicleAction('turret_fire', aim, pid)).toBe(true);
    expect(session.defense.stats.shots).toBe(shots + 1);

    // A broadcast with no tick in between (the server loop's zero-tick callback): the fired
    // entry is still in the sim's event buffer, so the state keeps its prior revision.
    expect(turretStateWireJson(session, sim.tickCount)).toBe(json);
    const events = sim.tick();
    const fired = events.filter((e) => e.type === 'turretDefense' && e.event.type === 'fired');
    expect(fired).toHaveLength(1);
    const next = JSON.parse(turretStateWireJson(session, sim.tickCount));
    expect(next.defense.stats.shots).toBe(shots + 1);
  });
});
