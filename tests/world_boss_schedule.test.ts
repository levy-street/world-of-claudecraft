// The world-boss scheduler pass on its own (src/sim/world_boss.ts tickWorldBossSchedule):
// the per-slot lifecycle over a literal state bag and a stub seam, so each arm is pinned
// directly rather than only through Sim internals (tests/world_boss.test.ts and
// tests/slumber.test.ts drive the live loop).
import { describe, expect, it, vi } from 'vitest';
import { MOBS } from '../src/sim/data';
import { DAWN_PHASE } from '../src/sim/day_night';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity } from '../src/sim/types';
import {
  tickWorldBossSchedule,
  WORLD_BOSSES,
  type WorldBossDef,
  type WorldBossScheduleState,
} from '../src/sim/world_boss';

const BALGATH = 'balgath_cyclops';
const slot = WORLD_BOSSES.findIndex((b) => b.templateId === BALGATH);
const other = WORLD_BOSSES.findIndex((b) => !MOBS[b.templateId]?.slumber);

function rig(opts: { phase: number | null; time?: number; entities?: Map<number, Entity> }) {
  const dropEntity = vi.fn();
  const entities = opts.entities ?? new Map<number, Entity>();
  const ctx = {
    dayNightPhase: () => opts.phase,
    entities,
    time: opts.time ?? 0,
    dropEntity,
  } as unknown as SimContext;
  const state: WorldBossScheduleState = {
    nextAt: WORLD_BOSSES.map(() => Number.POSITIVE_INFINITY),
    entityIds: WORLD_BOSSES.map(() => null),
    riseAtDawn: WORLD_BOSSES.map(() => false),
    clock: { lastPhase: null },
  };
  const spawned: WorldBossDef[] = [];
  let nextId = 900;
  const spawn = (def: WorldBossDef) => {
    spawned.push(def);
    // Register a live entity, exactly as the real spawn primitive does (Sim.spawnWorldBoss
    // calls addEntity). A stub that only returns an id leaves ctx.entities empty, so the
    // next pass reads the slot's occupant as gone, clears it, and spawns again: the rig,
    // not the scheduler, would be the thing under test.
    const id = nextId++;
    entities.set(id, {
      id,
      dead: false,
      corpseTimer: 0,
      summonedIds: [],
      // The live pass scales his HP pool by the contributor count every tick
      // (scaleWorldBossHp), which walks the threat table.
      threat: new Map<number, number>(),
      hp: def.hpScale.base,
      maxHp: def.hpScale.base,
    } as unknown as Entity);
    return id;
  };
  return { ctx, state, spawn, spawned, dropEntity };
}

const deadCorpse = (id: number, adds: number[] = []): Entity =>
  ({ id, dead: true, corpseTimer: 0, summonedIds: adds }) as unknown as Entity;

describe('the world-boss scheduler pass', () => {
  it('has both kinds of slot to schedule', () => {
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(other).toBeGreaterThanOrEqual(0);
    expect(slot).not.toBe(other);
  });

  it('spawns an empty slot when its interval comes due, once, and advances the clock', () => {
    const r = rig({ phase: null, time: 100 });
    r.state.nextAt[other] = 100;
    tickWorldBossSchedule(r.ctx, r.state, r.spawn);
    expect(r.spawned).toEqual([WORLD_BOSSES[other]]);
    expect(r.state.entityIds[other]).toBe(900);
    expect(r.state.nextAt[other]).toBe(100 + WORLD_BOSSES[other].intervalSeconds);
    // Due again with the slot occupied: the interval advances but nobody spawns twice.
    r.state.nextAt[other] = 100;
    tickWorldBossSchedule(r.ctx, r.state, r.spawn);
    expect(r.spawned).toHaveLength(1);
  });

  it('drops a finished corpse and its adds, and frees the slot', () => {
    const entities = new Map<number, Entity>([[5, deadCorpse(5, [6, 7])]]);
    const r = rig({ phase: null, entities });
    r.state.entityIds[other] = 5;
    tickWorldBossSchedule(r.ctx, r.state, r.spawn);
    expect(r.dropEntity.mock.calls.map((c) => c[0])).toEqual([6, 7, 5]);
    expect(r.state.entityIds[other]).toBeNull();
    // A non-slumbering boss never waits for sunrise.
    expect(r.state.riseAtDawn[other]).toBe(false);
  });

  it('clears a slot whose entity vanished without a corpse pass', () => {
    const r = rig({ phase: null });
    r.state.entityIds[other] = 42;
    tickWorldBossSchedule(r.ctx, r.state, r.spawn);
    expect(r.state.entityIds[other]).toBeNull();
  });

  it('holds a slain sleeper for the dawn: the interval passes him by', () => {
    const entities = new Map<number, Entity>([[5, deadCorpse(5)]]);
    const r = rig({ phase: 0.5, time: 100, entities });
    r.state.entityIds[slot] = 5;
    r.state.nextAt[slot] = 100;
    tickWorldBossSchedule(r.ctx, r.state, r.spawn);
    expect(r.state.entityIds[slot]).toBeNull();
    expect(r.state.riseAtDawn[slot]).toBe(true);
    // The interval that came due this same pass did not bring him back...
    expect(r.spawned).toEqual([]);
    expect(r.state.nextAt[slot]).toBe(100 + WORLD_BOSSES[slot].intervalSeconds);
    // ...and neither does the next one, at noon.
    r.state.nextAt[slot] = 100;
    tickWorldBossSchedule(r.ctx, r.state, r.spawn);
    expect(r.spawned).toEqual([]);
  });

  it('spawns him exactly once on the dawn edge, then hands the slot back to the interval', () => {
    const r = rig({ phase: DAWN_PHASE - 0.01 });
    r.state.riseAtDawn[slot] = true;
    tickWorldBossSchedule(r.ctx, r.state, r.spawn); // before sunrise: nothing
    expect(r.spawned).toEqual([]);
    (r.ctx as unknown as { dayNightPhase: () => number }).dayNightPhase = () => DAWN_PHASE + 0.01;
    tickWorldBossSchedule(r.ctx, r.state, r.spawn); // the crossing
    expect(r.spawned).toEqual([WORLD_BOSSES[slot]]);
    expect(r.state.riseAtDawn[slot]).toBe(false);
    expect(r.state.entityIds[slot]).toBe(900);
    tickWorldBossSchedule(r.ctx, r.state, r.spawn); // same phase again: no second crossing
    expect(r.spawned).toHaveLength(1);
  });

  it('never fires the dawn edge on the first clocked pass (no previous reading)', () => {
    const r = rig({ phase: DAWN_PHASE + 0.01 });
    r.state.riseAtDawn[slot] = true;
    tickWorldBossSchedule(r.ctx, r.state, r.spawn);
    expect(r.spawned).toEqual([]);
    expect(r.state.clock.lastPhase).toBe(DAWN_PHASE + 0.01);
  });

  it('keeps the interval cadence for the sleeper on a clockless host', () => {
    const entities = new Map<number, Entity>([[5, deadCorpse(5)]]);
    const r = rig({ phase: null, time: 100, entities });
    r.state.entityIds[slot] = 5;
    r.state.nextAt[slot] = 100;
    tickWorldBossSchedule(r.ctx, r.state, r.spawn);
    // No night, no dawn to wait for: the corpse drops and the due interval respawns him.
    expect(r.state.riseAtDawn[slot]).toBe(false);
    expect(r.spawned).toEqual([WORLD_BOSSES[slot]]);
  });
});
