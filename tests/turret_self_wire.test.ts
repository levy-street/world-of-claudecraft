import { describe, expect, it } from 'vitest';
import {
  emitTurretSelfKeys,
  turretPlanWireJson,
  turretStateWireJson,
} from '../server/turret_self_wire';
import { BUILTIN_WORLD } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import type { TurretSession, WorldContent } from '../src/sim/types';
import { turretSessionFor } from '../src/sim/vehicles';
import { WORLD_SEED } from '../src/sim/world_seed';

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
    expect(JSON.parse(stateJson)).toEqual({ ...view, defense: state });
    expect(JSON.parse(planJson)).toEqual(plan);
    const wire = JSON.parse(stateJson);
    expect(wire).not.toHaveProperty('feedback');
    for (const key of ['plan', 'seed', 'tick']) expect(wire.defense).not.toHaveProperty(key);
    expect(session.defense.plan).toBe(plan);
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
