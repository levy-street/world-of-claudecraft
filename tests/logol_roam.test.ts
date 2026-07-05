import { describe, expect, it } from 'vitest';
import { LOGOL_NPC_ID, LOGOL_POIS } from '../src/sim/content/logol';
import {
  LOGOL_APPEAR_PERIOD,
  LOGOL_VISIT_DURATION,
  logolPresence,
  makeLogolRoamState,
  updateLogolRoam,
} from '../src/sim/logol_roam';
import type { SimContext } from '../src/sim/sim_context';
import type { Entity, Vec3 } from '../src/sim/types';

// A minimal SimContext stand-in exercising only what updateLogolRoam touches.
function fakeCtx(time: number) {
  const entities = new Map<number, Entity>();
  const ctx = {
    time,
    nextId: 1000,
    entities,
    groundPos: (x: number, z: number): Vec3 => ({ x, y: 0, z }),
    addEntity: (e: Entity) => entities.set(e.id, e),
    dropEntity: (id: number) => entities.delete(id),
  } as unknown as SimContext;
  return { ctx, entities };
}

describe('logolPresence (pure, clock-derived)', () => {
  it('is present at the start of a window and absent in the gap', () => {
    expect(logolPresence(0).present).toBe(true);
    expect(logolPresence(LOGOL_VISIT_DURATION - 1).present).toBe(true);
    expect(logolPresence(LOGOL_VISIT_DURATION + 1).present).toBe(false);
    expect(logolPresence(LOGOL_APPEAR_PERIOD - 1).present).toBe(false);
    // Next window: present again.
    expect(logolPresence(LOGOL_APPEAR_PERIOD).present).toBe(true);
  });

  it('is deterministic and returns an in-range POI index', () => {
    for (const t of [0, 123, LOGOL_APPEAR_PERIOD, 5 * LOGOL_APPEAR_PERIOD + 7]) {
      const a = logolPresence(t);
      const b = logolPresence(t);
      expect(a).toEqual(b);
      expect(a.poiIndex).toBeGreaterThanOrEqual(0);
      expect(a.poiIndex).toBeLessThan(LOGOL_POIS.length);
    }
  });
});

describe('updateLogolRoam (reconcile against the clock)', () => {
  const logolEntity = (entities: Map<number, Entity>) =>
    [...entities.values()].find((e) => e.templateId === LOGOL_NPC_ID);

  it('spawns the persistent Harbinger plus a present Logol, idempotently', () => {
    const state = makeLogolRoamState();
    const { ctx, entities } = fakeCtx(0);
    updateLogolRoam(ctx, state);
    // Harbinger (persistent) + Logol (present window).
    expect(entities.size).toBe(2);
    const logol = logolEntity(entities);
    expect(logol).toBeDefined();
    expect(logol?.npcVoiceClipBaseUrl).toBe('/audio/logol');
    expect(state.entityId).toBe(logol?.id);
    expect(state.harbingerId).not.toBeNull();
    // Calling again in the same window spawns neither a second Logol nor Harbinger.
    updateLogolRoam(ctx, state);
    expect(entities.size).toBe(2);
  });

  it('despawns Logol once the window ends but keeps the Harbinger', () => {
    const state = makeLogolRoamState();
    // Present: spawn Harbinger + Logol.
    const present = fakeCtx(0);
    updateLogolRoam(present.ctx, state);
    expect(present.entities.size).toBe(2);
    expect(state.entityId).not.toBeNull();
    // Absent window: carry state + entities forward, then reconcile.
    const absent = fakeCtx(LOGOL_VISIT_DURATION + 10);
    for (const e of present.entities.values()) absent.entities.set(e.id, e);
    updateLogolRoam(absent.ctx, state);
    // Logol gone, Harbinger remains.
    expect(logolEntity(absent.entities)).toBeUndefined();
    expect(state.entityId).toBeNull();
    expect(absent.entities.size).toBe(1);
  });
});
