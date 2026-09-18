import { describe, expect, it } from 'vitest';
import {
  SHADOW_GUARDS,
  SHADOW_LANTERN_CONE,
  SHADOW_SAFE_SPOT,
  SHADOW_WIDE_CIRCLE_FILL_SECONDS,
} from '../src/sim/content/world_quest_shadow';
import {
  shadowBehindCarrier,
  shadowGuardDetects,
  shadowPatrolPosition,
} from '../src/sim/world_quest_shadow_patrol';

type GuardRow = (typeof SHADOW_GUARDS)[number];

function guardAt(
  row: GuardRow,
  seconds: number,
): { pos: { x: number; z: number }; facing: number } {
  if (!row.patrol) return { pos: row.npc.pos, facing: row.npc.facing };
  const p = shadowPatrolPosition(row.npc.pos, row.patrol, seconds);
  return { pos: { x: p.x, z: p.z }, facing: p.facing };
}

describe('lantern detection rule', () => {
  const cone = { detectionRadius: 1.5, cone: { radius: 10, halfAngle: Math.PI / 4 } };
  const guard = { pos: { x: 0, z: 0 }, facing: 0 };
  it('sees straight ahead inside the cone and nothing behind or beside it', () => {
    expect(shadowGuardDetects(cone, guard, { x: 0, z: 6 })).toBe(true);
    expect(shadowGuardDetects(cone, guard, { x: 3.9, z: 4 })).toBe(true);
    expect(shadowGuardDetects(cone, guard, { x: 5, z: 4 })).toBe(false);
    expect(shadowGuardDetects(cone, guard, { x: 0, z: -6 })).toBe(false);
    expect(shadowGuardDetects(cone, guard, { x: 8, z: 0 })).toBe(false);
  });
  it('stops at the cone radius but always keeps the contact circle', () => {
    expect(shadowGuardDetects(cone, guard, { x: 0, z: 9.9 })).toBe(true);
    expect(shadowGuardDetects(cone, guard, { x: 0, z: 10.1 })).toBe(false);
    expect(shadowGuardDetects(cone, guard, { x: 0, z: -1.2 })).toBe(true);
    expect(shadowGuardDetects({ detectionRadius: 1.2 }, guard, { x: 0, z: 1.1 })).toBe(true);
    expect(shadowGuardDetects({ detectionRadius: 1.2 }, guard, { x: 0, z: 1.3 })).toBe(false);
  });
  it('turns with the guard facing', () => {
    const west = { pos: { x: 0, z: 0 }, facing: -Math.PI / 2 };
    expect(shadowGuardDetects(cone, west, { x: -6, z: 0 })).toBe(true);
    expect(shadowGuardDetects(cone, west, { x: 6, z: 0 })).toBe(false);
  });
  it('gives every lantern guard the same wide beam and every carrier a bare contact circle', () => {
    let wide = 0;
    for (const row of SHADOW_GUARDS) {
      if (row.sentry) {
        expect(row.cone, row.npc.id).toBe(SHADOW_LANTERN_CONE);
        expect(row.detectionRadius).toBeLessThanOrEqual(2);
      } else {
        expect(row.cone, row.npc.id).toBeUndefined();
        if (row.detectionRadius > 1.5) {
          // A wide circle must fill slowly enough to lift the dispatch and leave.
          wide++;
          expect(row.contactFillSeconds, row.npc.id).toBe(SHADOW_WIDE_CIRCLE_FILL_SECONDS);
          // The steal itself lasts one second; the circle must allow it twice over.
          expect(row.contactFillSeconds).toBeGreaterThan(2);
        } else {
          expect(row.contactFillSeconds, row.npc.id).toBeUndefined();
        }
      }
    }
    expect(wide).toBe(2);
    expect(SHADOW_LANTERN_CONE.radius).toBeGreaterThanOrEqual(8);
    expect(SHADOW_LANTERN_CONE.halfAngle).toBeGreaterThanOrEqual(0.7);
  });
});

describe('readable lantern patrol openings', () => {
  it('pauses at each endpoint and walks continuously between watches', () => {
    const start = { x: 0, z: 0 },
      patrol = { x: 24, z: 0, period: 12, pause: 3 };
    expect(shadowPatrolPosition(start, patrol, 0).x).toBe(0);
    expect(shadowPatrolPosition(start, patrol, 2.9).x).toBe(0);
    expect(shadowPatrolPosition(start, patrol, 9).x).toBe(12);
    expect(shadowPatrolPosition(start, patrol, 15).x).toBe(24);
    expect(shadowPatrolPosition(start, patrol, 17.9).x).toBe(24);
    expect(shadowPatrolPosition(start, patrol, 24).x).toBe(12);
    expect(shadowPatrolPosition(start, patrol, 30).x).toBe(0);
  });
  it('gives every carrier repeated safe three-second rear openings and genuine patrol danger', () => {
    const lanterns = SHADOW_GUARDS.filter((row) => row.sentry);
    for (const carrier of SHADOW_GUARDS.filter((row) => !row.sentry)) {
      const player = {
        x: carrier.npc.pos.x - 2 * Math.sin(carrier.npc.facing),
        z: carrier.npc.pos.z - 2 * Math.cos(carrier.npc.facing),
      };
      let safe = 0,
        longest = 0,
        danger = 0,
        windows = 0;
      for (let i = 0; i < 2400; i++) {
        const exposed = lanterns.some((row) =>
          shadowGuardDetects(row, guardAt(row, i / 20), player),
        );
        if (exposed) {
          danger++;
          safe = 0;
        } else {
          safe++;
          longest = Math.max(longest, safe);
          if (safe === 60) windows++;
        }
      }
      expect(longest, carrier.npc.id).toBeGreaterThanOrEqual(60);
      expect(windows, carrier.npc.id).toBeGreaterThanOrEqual(2);
      expect(danger, carrier.npc.id).toBeGreaterThan(0);
      expect(
        shadowBehindCarrier(player, { pos: carrier.npc.pos, facing: carrier.npc.facing }),
      ).toBe(true);
    }
  });
  it('never lets a fixed watchman cover a carrier rear pocket permanently', () => {
    for (const watch of SHADOW_GUARDS.filter((row) => row.sentry && !row.patrol)) {
      for (const carrier of SHADOW_GUARDS.filter((row) => !row.sentry)) {
        const rear = {
          x: carrier.npc.pos.x - 2 * Math.sin(carrier.npc.facing),
          z: carrier.npc.pos.z - 2 * Math.cos(carrier.npc.facing),
        };
        expect(shadowGuardDetects(watch, guardAt(watch, 0), rear), watch.npc.id).toBe(false);
      }
    }
  });
});

it('keeps the cloak start and retreat point outside every lantern for the whole cycle', () => {
  for (let i = 0; i < 2400; i++) {
    for (const row of SHADOW_GUARDS.filter((guard) => guard.sentry)) {
      expect(shadowGuardDetects(row, guardAt(row, i / 20), SHADOW_SAFE_SPOT)).toBe(false);
    }
  }
});
