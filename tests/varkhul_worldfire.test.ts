import { describe, expect, it } from 'vitest';
import {
  activeVarkhulWorldfire,
  VARKHUL_WORLDFIRE_ARENA_RADIUS,
  VARKHUL_WORLDFIRE_DAMAGE_MAX_HP,
  VARKHUL_WORLDFIRE_FILL_SECONDS,
  VARKHUL_WORLDFIRE_FULL_DAMAGE_MAX_HP,
  VARKHUL_WORLDFIRE_INITIAL_SAFE_RADIUS,
  VARKHUL_WORLDFIRE_STAGE_SECONDS,
  VARKHUL_WORLDFIRE_STAGES,
  VARKHUL_WORLDFIRE_TICK_SECONDS,
  VARKHUL_WORLDFIRE_TOTAL_SECONDS,
  varkhulWorldfireBurnsPosition,
  varkhulWorldfireDamageMaxHp,
  varkhulWorldfireMarkerRemaining,
  varkhulWorldfireSafeRadius,
  varkhulWorldfireStage,
} from '../src/sim/varkhul_worldfire';

describe('Varkhul Worldfire', () => {
  it('pins the Heroic room-fill clock, geometry, and six seven-second closures', () => {
    expect(VARKHUL_WORLDFIRE_TOTAL_SECONDS).toBe(45);
    expect(VARKHUL_WORLDFIRE_FILL_SECONDS).toBe(42);
    expect(VARKHUL_WORLDFIRE_STAGES).toBe(6);
    expect(VARKHUL_WORLDFIRE_STAGE_SECONDS).toBe(7);
    expect(VARKHUL_WORLDFIRE_ARENA_RADIUS).toBe(40);
    expect(VARKHUL_WORLDFIRE_INITIAL_SAFE_RADIUS).toBe(36);
    expect(VARKHUL_WORLDFIRE_TICK_SECONDS).toBe(1);
    expect(Array.from({ length: 7 }, (_, stage) => varkhulWorldfireSafeRadius(stage))).toEqual([
      36, 30, 24, 18, 12, 6, 0,
    ]);
  });

  it('advances only at exact stage boundaries and fills the room with three seconds left', () => {
    expect(varkhulWorldfireStage(45)).toBe(0);
    expect(varkhulWorldfireStage(38.0001)).toBe(0);
    expect(varkhulWorldfireStage(38)).toBe(1);
    expect(varkhulWorldfireStage(31)).toBe(2);
    expect(varkhulWorldfireStage(3.0001)).toBe(5);
    expect(varkhulWorldfireStage(3)).toBe(6);
    expect(varkhulWorldfireStage(0)).toBe(6);
  });

  it('burns the outer room first, preserves the current safe circle, then burns everything', () => {
    const center = { x: 100, z: -50 };
    expect(varkhulWorldfireBurnsPosition(center, { x: 135.999, z: -50 }, 0)).toBe(false);
    expect(varkhulWorldfireBurnsPosition(center, { x: 136, z: -50 }, 0)).toBe(true);
    expect(varkhulWorldfireBurnsPosition(center, { x: 100, z: -50 }, 5)).toBe(false);
    expect(varkhulWorldfireBurnsPosition(center, { x: 100, z: -50 }, 6)).toBe(true);
  });

  it('uses lethal full-room ticks without changing the avoidable fire ticks', () => {
    expect(VARKHUL_WORLDFIRE_DAMAGE_MAX_HP).toBe(0.12);
    expect(VARKHUL_WORLDFIRE_FULL_DAMAGE_MAX_HP).toBe(0.3);
    expect(varkhulWorldfireDamageMaxHp(5)).toBe(0.12);
    expect(varkhulWorldfireDamageMaxHp(6)).toBe(0.3);
  });

  it('treats the permanent post-deadline marker as full-room Worldfire', () => {
    expect(varkhulWorldfireMarkerRemaining(38, false)).toBe(38);
    expect(varkhulWorldfireMarkerRemaining(Number.POSITIVE_INFINITY, true)).toBe(0);
    expect(varkhulWorldfireMarkerRemaining(604_800, true)).toBe(0);
  });

  it('projects only the Heroic phase and exposes the time until the whole room burns', () => {
    expect(activeVarkhulWorldfire(7, 'normal', true, 45, { x: 2, z: 3 })).toBeNull();
    expect(activeVarkhulWorldfire(7, 'heroic', false, 45, { x: 2, z: 3 })).toBeNull();
    expect(activeVarkhulWorldfire(7, 'heroic', true, 38, { x: 2, z: 3 })).toEqual({
      bossId: 7,
      centerX: 2,
      centerZ: 3,
      arenaRadius: 40,
      safeRadius: 30,
      stage: 1,
      stages: 6,
      remaining: 38,
      untilFull: 35,
      duration: 45,
      full: false,
    });
    expect(activeVarkhulWorldfire(7, 'heroic', true, 3, { x: 2, z: 3 })?.full).toBe(true);
    expect(activeVarkhulWorldfire(7, 'heroic', true, 3, { x: 2, z: 3 })?.untilFull).toBe(0);
  });
});
