import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  emitTurretSelfKeys,
  TURRET_MONSTER_BUCKETS,
  TURRET_MONSTER_KEYS,
  TURRET_SEAT_KEYS,
  turretPlanWireJson,
  turretStateWireParts,
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
import { turretStateWireJson } from './helpers/turret_seat_wire';

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

function keys(
  meta: Parameters<typeof emitTurretSelfKeys>[1],
  tick = 0,
  held: Readonly<Record<string, string>> = {},
): [string, string][] {
  const out: [string, string][] = [];
  emitTurretSelfKeys((key, serialized) => out.push([key, serialized]), meta, tick, held);
  return out;
}

/** The family's texts by key, as one pass emits them. */
function family(meta: Parameters<typeof emitTurretSelfKeys>[1], tick: number) {
  return Object.fromEntries(keys(meta, tick).slice(1));
}

describe('the turret self keys', () => {
  it('gives a session that never sat only the plan and the seat key, as explicit nulls', () => {
    expect(keys({ vehicle: null })).toEqual([
      ['turp', 'null'],
      ['tur', 'null'],
    ]);
    const cleared = Object.fromEntries(TURRET_SEAT_KEYS.map((key) => [key, 'null']));
    expect(keys({ vehicle: null }, 0, cleared)).toEqual([
      ['turp', 'null'],
      ['tur', 'null'],
    ]);
  });

  it('nulls every family key a left seat still holds, plan first', () => {
    const held = Object.fromEntries(TURRET_SEAT_KEYS.map((key) => [key, '[]']));
    expect(keys({ vehicle: null }, 0, held)).toEqual([
      ['turp', 'null'],
      ...TURRET_SEAT_KEYS.map((key) => [key, 'null']),
    ]);
  });

  it('names a family of short keys: the seat, the sections, then one per monster bucket', () => {
    expect(TURRET_SEAT_KEYS.slice(0, 6)).toEqual(['tur', 'tuv', 'tua', 'tus', 'tub', 'tut']);
    expect(TURRET_MONSTER_KEYS).toEqual(
      Array.from({ length: TURRET_MONSTER_BUCKETS }, (_, i) => `tu${i}`),
    );
    expect(TURRET_SEAT_KEYS.slice(6)).toEqual(TURRET_MONSTER_KEYS);
    expect(new Set(['turp', ...TURRET_SEAT_KEYS]).size).toBe(TURRET_SEAT_KEYS.length + 1);
  });

  it('puts each monster in bucket id mod the count, in the engine order of ascending ids', () => {
    const { sim, pid, meta } = seated();
    let crowded = 0;
    for (let i = 0; i < 1200; i++) {
      sim.tick();
      const engine = turretSessionFor(sim.ctx, pid)!.defense.monsters.map((m) => m.id);
      expect(engine).toEqual([...engine].sort((a, b) => a - b));
      const wire = family(meta, sim.tickCount);
      const carried: number[] = [];
      for (const [bucket, key] of TURRET_MONSTER_KEYS.entries()) {
        const ids = (JSON.parse(wire[key]) as { id: number }[]).map((m) => m.id);
        expect(ids).toEqual([...ids].sort((a, b) => a - b));
        for (const id of ids) expect(id % TURRET_MONSTER_BUCKETS).toBe(bucket);
        carried.push(...ids);
      }
      expect(carried.sort((a, b) => a - b)).toEqual(engine);
      if (engine.length > 1) crowded++;
    }
    expect(crowded).toBeGreaterThan(0);
  });

  it('carries the view minus the feedback ring and the plan, which rides alone', () => {
    const { sim, pid, meta, session } = seated();
    for (let i = 0; i < 200; i++) sim.tick();
    const [[planKey, planJson], ...emitted] = keys(meta, sim.tickCount);
    expect(planKey).toBe('turp');
    expect(emitted.map(([key]) => key)).toEqual(TURRET_SEAT_KEYS);
    const stateJson = turretStateWireJson(session, sim.tickCount);
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
    const [[, planJson], ...parts] = keys(meta, sim.tickCount);
    const onWire = numbersIn(
      parts.filter(([key]) => key !== 'tut').map(([, text]) => JSON.parse(text)),
    );
    expect(onWire.some(([key, n]) => key === 'dx' && !Number.isInteger(n))).toBe(true);
    for (const [key, n] of onWire) {
      const scale = FINE_KEYS.includes(key) ? 1e5 : 1e3;
      expect(Math.round(n * scale) / scale).toBe(n);
    }
    const exact = numbersIn(turretSessionFor(sim.ctx, pid)!.defense.monsters);
    const shown = numbersIn(
      JSON.parse(turretStateWireJson(session, sim.tickCount)).defense.monsters,
    );
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
    const plan = turretPlanWireJson(session.defense.plan);
    let rev = session.defense.rev;
    let quiet = 0;
    let moved = 0;
    let parts = turretStateWireParts(session, sim.tickCount);
    for (let i = 0; i < 400; i++) {
      sim.tick();
      const next = turretStateWireParts(session, sim.tickCount);
      if (session.defense.rev === rev) {
        expect(next).toBe(parts);
        quiet++;
      } else {
        expect(next).not.toBe(parts);
        rev = session.defense.rev;
        moved++;
      }
      parts = next;
      expect(turretPlanWireJson(session.defense.plan)).toBe(plan);
    }
    expect(quiet).toBeGreaterThan(0);
    expect(moved).toBeGreaterThan(0);
  });

  it('keeps the string of every key a revision left alone, so only the moved keys resend', () => {
    const { sim, pid, session } = seated();
    let prior = turretStateWireParts(session, sim.tickCount);
    let revisions = 0;
    let kept = 0;
    let resent = 0;
    for (let i = 0; i < 1200; i++) {
      sim.tick();
      const defense = session.defense;
      const target = defense.monsters.find((m) => m.hp > 0);
      if (defense.phase === 'wave' && sim.tickCount >= defense.readyTick && target)
        sim.useVehicleAction('turret_fire', positionAt(target.seg, sim.tickCount, ground), pid);
      const parts = turretStateWireParts(session, sim.tickCount);
      if (parts === prior) continue;
      revisions++;
      // The revision key moves on every revision, so no revision resends nothing.
      expect(parts[1]).not.toBe(prior[1]);
      for (const [i, text] of parts.entries()) {
        if (text !== prior[i]) resent++;
        else kept++;
      }
      prior = parts;
    }
    expect(revisions).toBeGreaterThan(50);
    // Most of the family stays put on a revision: a few keys move, the buckets mostly rest.
    expect(resent / revisions).toBeLessThan(6);
    expect(kept / revisions).toBeGreaterThan(TURRET_SEAT_KEYS.length - 6);
  });

  it("hands back the prior revision's string object for an unchanged part", () => {
    // Strings compare by value, so no runtime check can see which object a part is: the
    // source pins the reuse that keeps every session's 38 diffs a pointer compare.
    const source = readFileSync(
      fileURLToPath(new URL('../server/turret_self_wire.ts', import.meta.url)),
      'utf8',
    );
    expect(source).toMatch(/if \(text === prior\[i\]\) parts\[i\] = prior\[i\];/);
    expect(source).toMatch(
      /turretSeatWireParts\(\{ \.\.\.seat, defense: state \}, cached\?\.parts\)/,
    );
  });

  it('holds a shot fired between ticks until a tick has routed its fired entry', () => {
    const { sim, pid, session } = seated();
    let parts: readonly string[] = [];
    for (let i = 0; i < 400; i++) {
      sim.tick();
      parts = turretStateWireParts(session, sim.tickCount);
      const defense = session.defense;
      if (defense.phase === 'wave' && sim.tickCount >= defense.readyTick) break;
    }
    const shots = session.defense.stats.shots;
    const aim = { x: session.defense.cx + 20, z: session.defense.cz };
    expect(sim.useVehicleAction('turret_fire', aim, pid)).toBe(true);
    expect(session.defense.stats.shots).toBe(shots + 1);

    // A broadcast with no tick in between (the server loop's zero-tick callback): the fired
    // entry is still in the sim's event buffer, so the state keeps its prior revision.
    expect(turretStateWireParts(session, sim.tickCount)).toBe(parts);
    const events = sim.tick();
    const fired = events.filter((e) => e.type === 'turretDefense' && e.event.type === 'fired');
    expect(fired).toHaveLength(1);
    const next = JSON.parse(turretStateWireJson(session, sim.tickCount));
    expect(next.defense.stats.shots).toBe(shots + 1);
  });
});
