import { describe, expect, it } from 'vitest';
import {
  LOGOL_APPEAR_POS,
  LOGOL_HARBINGER_NPC_ID,
  LOGOL_NPC_ID,
  logolOfferedWares,
} from '../src/sim/content/logol';
import {
  LOGOL_APPEAR_PERIOD_MS,
  LOGOL_VISIT_MS,
  logolNextChangeMs,
  logolPresent,
  logolWeekIndex,
  makeLogolRoamState,
  updateLogolRoam,
} from '../src/sim/logol_roam';
import { Sim } from '../src/sim/sim';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, Vec3 } from '../src/sim/types';

// A minimal SimContext stand-in exercising only what updateLogolRoam touches.
function fakeCtx() {
  const entities = new Map<number, Entity>();
  const ctx = {
    nextId: 1000,
    entities,
    groundPos: (x: number, z: number): Vec3 => ({ x, y: 0, z }),
    addEntity: (e: Entity) => {
      entities.set(e.id, e);
    },
    dropEntity: (id: number) => {
      entities.delete(id);
    },
  } as unknown as SimContext;
  return { ctx, entities };
}

const WEEK = LOGOL_APPEAR_PERIOD_MS;

describe('logolPresent / logolWeekIndex (pure, wall-clock weekly)', () => {
  it('is present for the first days of each week and absent for the rest', () => {
    expect(logolPresent(0)).toBe(true);
    expect(logolPresent(LOGOL_VISIT_MS - 1)).toBe(true);
    expect(logolPresent(LOGOL_VISIT_MS)).toBe(false);
    expect(logolPresent(WEEK - 1)).toBe(false);
    // Next week: present again, same schedule.
    expect(logolPresent(WEEK)).toBe(true);
    expect(logolPresent(5 * WEEK + LOGOL_VISIT_MS + 1)).toBe(false);
  });

  it('the visit is a strict subset of the week (an absent gap always exists)', () => {
    expect(LOGOL_VISIT_MS).toBeLessThan(WEEK);
    expect(LOGOL_VISIT_MS).toBeGreaterThan(0);
  });

  it('weekIndex advances exactly once per period and drives a new stock', () => {
    expect(logolWeekIndex(0)).toBe(0);
    expect(logolWeekIndex(WEEK - 1)).toBe(0);
    expect(logolWeekIndex(WEEK)).toBe(1);
    expect(logolWeekIndex(10 * WEEK + 123)).toBe(10);
    // Adjacent weeks offer different rotating stock (the "new infinity items").
    const w0 = logolOfferedWares(logolWeekIndex(0)).map((w) => w.id);
    const w1 = logolOfferedWares(logolWeekIndex(WEEK)).map((w) => w.id);
    expect(w1).not.toEqual(w0);
  });

  it('nextChangeMs points at the window close while present, else the next open', () => {
    expect(logolNextChangeMs(0)).toBe(LOGOL_VISIT_MS);
    expect(logolNextChangeMs(LOGOL_VISIT_MS + 1)).toBe(WEEK);
    expect(logolNextChangeMs(WEEK + 1)).toBe(WEEK + LOGOL_VISIT_MS);
  });

  it('pins the epoch-anchored schedule to literal instants (restart cannot move it)', () => {
    // A realm reboot re-creates all runtime state; presence depends only on
    // epoch ms, so the schedule is pinned here against LITERAL wall-clock
    // instants. Unix epoch (1970-01-01) is a Thursday, so with a 3 day visit the
    // window runs Thu 00:00 UTC to Sun 00:00 UTC every week.
    const table: Array<[string, boolean]> = [
      ['2026-07-02T00:00:00Z', true], // Thursday: window opens
      ['2026-07-04T23:59:59Z', true], // Saturday night: still trading
      ['2026-07-05T00:00:00Z', false], // Sunday 00:00 UTC: gone
      ['2026-07-08T12:00:00Z', false], // Wednesday: away
      ['2026-07-09T00:00:00Z', true], // next Thursday: back
    ];
    for (const [iso, present] of table) {
      expect(logolPresent(Date.parse(iso)), iso).toBe(present);
    }
    // And the two Thursdays above are adjacent week indices.
    expect(logolWeekIndex(Date.parse('2026-07-09T00:00:00Z'))).toBe(
      logolWeekIndex(Date.parse('2026-07-02T00:00:00Z')) + 1,
    );
  });
});

describe('Sim tick integration (SimConfig.logolEnabled + lockoutNowMs)', () => {
  const findByTemplate = (sim: Sim, templateId: string) =>
    [...sim.entities.values()].find((e) => e.templateId === templateId);

  it('an enabled Sim spawns Logol and the Harbinger through the real tick, then despawns Logol when the window closes', () => {
    let now = 100 * WEEK + 1000; // inside week 100's visit window
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      noPlayer: true,
      logolEnabled: true,
      lockoutNowMs: () => now,
    });
    sim.tick();
    const logol = findByTemplate(sim, LOGOL_NPC_ID);
    expect(logol).toBeDefined();
    expect(logol?.npcVoiceClipBaseUrl).toBe('/audio/logol');
    expect(findByTemplate(sim, LOGOL_HARBINGER_NPC_ID)).toBeDefined();
    // Advance the wall clock past the window: the next tick reconciles him away
    // but keeps the quest-giving Harbinger.
    now = 100 * WEEK + LOGOL_VISIT_MS + 1000;
    sim.tick();
    expect(findByTemplate(sim, LOGOL_NPC_ID)).toBeUndefined();
    expect(findByTemplate(sim, LOGOL_HARBINGER_NPC_ID)).toBeDefined();
  });

  it('a default Sim (logolEnabled unset) never spawns either NPC', () => {
    const sim = new Sim({
      seed: 42,
      playerClass: 'warrior',
      noPlayer: true,
      lockoutNowMs: () => 100 * WEEK + 1000,
    });
    sim.tick();
    expect(findByTemplate(sim, LOGOL_NPC_ID)).toBeUndefined();
    expect(findByTemplate(sim, LOGOL_HARBINGER_NPC_ID)).toBeUndefined();
  });
});

describe('updateLogolRoam (reconcile against the injected clock)', () => {
  const logolEntity = (entities: Map<number, Entity>) =>
    [...entities.values()].find((e) => e.templateId === LOGOL_NPC_ID);

  it('spawns the persistent Harbinger plus a present Logol at his fixed spot', () => {
    const state = makeLogolRoamState();
    const { ctx, entities } = fakeCtx();
    updateLogolRoam(ctx, state, 0);
    // Harbinger (persistent) + Logol (open window).
    expect(entities.size).toBe(2);
    const logol = logolEntity(entities);
    expect(logol).toBeDefined();
    expect(logol?.pos.x).toBe(LOGOL_APPEAR_POS.x);
    expect(logol?.pos.z).toBe(LOGOL_APPEAR_POS.z);
    expect(logol?.npcVoiceClipBaseUrl).toBe('/audio/logol');
    expect(state.entityId).toBe(logol?.id);
    expect(state.harbingerId).not.toBeNull();
    // Same window, next ticks: no duplicate spawns.
    updateLogolRoam(ctx, state, 1000);
    expect(entities.size).toBe(2);
  });

  it('despawns Logol when the window closes, keeps the Harbinger, and returns him to the SAME spot next week', () => {
    const state = makeLogolRoamState();
    const { ctx, entities } = fakeCtx();
    updateLogolRoam(ctx, state, 0);
    expect(entities.size).toBe(2);
    // Window closes: Logol gone, Harbinger remains.
    updateLogolRoam(ctx, state, LOGOL_VISIT_MS + 1);
    expect(logolEntity(entities)).toBeUndefined();
    expect(state.entityId).toBeNull();
    expect(entities.size).toBe(1);
    // Next week's window: he is back, at the same fixed spot.
    updateLogolRoam(ctx, state, WEEK + 1);
    const logol = logolEntity(entities);
    expect(logol).toBeDefined();
    expect(logol?.pos.x).toBe(LOGOL_APPEAR_POS.x);
    expect(logol?.pos.z).toBe(LOGOL_APPEAR_POS.z);
  });
});
