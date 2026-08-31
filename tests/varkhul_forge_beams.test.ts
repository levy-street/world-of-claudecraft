import { describe, expect, it } from 'vitest';
import {
  VARKHUL_FORGE_BEAM_BLOCK_DAMAGE_TICK_SECONDS,
  VARKHUL_FORGE_BEAM_BLOCKER_RADIUS,
  VARKHUL_FORGE_BEAM_COLUMN_DISTANCE,
  VARKHUL_FORGE_BEAM_IDLE_COOLING_PER_SECOND_NORMAL,
  VARKHUL_FORGE_BEAM_MAX_PROGRESS,
  VARKHUL_FORGE_BEAM_MIN_PROGRESS,
  VARKHUL_FORGE_BEAM_WARMUP_SECONDS,
  VARKHUL_FORGE_MELTDOWN_DURATION_SECONDS,
  VARKHUL_FORGE_MELTDOWN_TICK_SECONDS,
  VARKHUL_FORGE_QUAKE_OVERHEAT,
  varkhulForgeBeamAssignments,
  varkhulForgeBeamBlockDamageMaxHp,
  varkhulForgeBeamColumns,
  varkhulForgeBeamExposureResetSeconds,
  varkhulForgeBeamOverheatAfterTick,
  varkhulForgeMeltdownInitialDamageMaxHp,
  varkhulForgeMeltdownTickDamageMaxHp,
  varkhulForgeOverheatAfterQuake,
} from '../src/sim/varkhul_forge_beams';

const FORGE = { x: 100, z: 220 };

describe('Varkhul forge beams', () => {
  it('places two separated columns on opposite sides of the forge', () => {
    expect(VARKHUL_FORGE_BEAM_COLUMN_DISTANCE).toBe(28);
    expect(varkhulForgeBeamColumns(FORGE)).toEqual([
      { index: 0, x: 72, z: 220 },
      { index: 1, x: 128, z: 220 },
    ]);
    expect(VARKHUL_FORGE_BEAM_BLOCKER_RADIUS).toBe(1.35);
    expect(VARKHUL_FORGE_BEAM_WARMUP_SECONDS).toBe(3);
  });

  it('selects the first living player physically intercepting each lane', () => {
    const assignments = varkhulForgeBeamAssignments(FORGE, [
      { id: 9, x: 80, z: 220, dead: false },
      { id: 4, x: 76, z: 220.8, dead: false },
      { id: 7, x: 124, z: 220, dead: true },
      { id: 6, x: 120, z: 219, dead: false },
      { id: 2, x: 100, z: 220, dead: false },
      { id: 3, x: 84, z: 223, dead: false },
    ]);

    expect(assignments).toEqual([
      { index: 0, blockerId: 4, impactX: 76, impactZ: 220 },
      { index: 1, blockerId: 6, impactX: 120, impactZ: 220 },
    ]);
  });

  it('excludes the shared forge mouth and never lets one player block both beams', () => {
    const assignments = varkhulForgeBeamAssignments(FORGE, [
      { id: 1, x: 100, z: 220, dead: false },
      { id: 2, x: 77, z: 220, dead: false },
    ]);

    expect(assignments[0].blockerId).toBe(2);
    expect(assignments[1].blockerId).toBeNull();
    expect(assignments[1].impactX).toBe(100);
    expect(assignments[1].impactZ).toBe(220);
  });

  it('owns the literal 12% through 80% interception interval inclusively', () => {
    expect(VARKHUL_FORGE_BEAM_MIN_PROGRESS).toBe(0.12);
    expect(VARKHUL_FORGE_BEAM_MAX_PROGRESS).toBe(0.8);
    const leftColumnX = FORGE.x - VARKHUL_FORGE_BEAM_COLUMN_DISTANCE;
    const xAt = (progress: number) => leftColumnX + (FORGE.x - leftColumnX) * progress;

    expect(
      varkhulForgeBeamAssignments(FORGE, [{ id: 1, x: xAt(0.12), z: FORGE.z, dead: false }])[0]
        .blockerId,
    ).toBe(1);
    expect(
      varkhulForgeBeamAssignments(FORGE, [{ id: 1, x: xAt(0.8), z: FORGE.z, dead: false }])[0]
        .blockerId,
    ).toBe(1);
    expect(
      varkhulForgeBeamAssignments(FORGE, [{ id: 1, x: xAt(0.119), z: FORGE.z, dead: false }])[0]
        .blockerId,
    ).toBeNull();
    expect(
      varkhulForgeBeamAssignments(FORGE, [{ id: 1, x: xAt(0.801), z: FORGE.z, dead: false }])[0]
        .blockerId,
    ).toBeNull();
  });

  it('includes the 1.35-yard tube edge and excludes the first point beyond it', () => {
    expect(
      varkhulForgeBeamAssignments(FORGE, [{ id: 1, x: 86, z: FORGE.z + 1.35, dead: false }])[0]
        .blockerId,
    ).toBe(1);
    expect(
      varkhulForgeBeamAssignments(FORGE, [{ id: 1, x: 86, z: FORGE.z + 1.351, dead: false }])[0]
        .blockerId,
    ).toBeNull();
  });

  it('cools only Normal while idle and never removes Heroic heat', () => {
    expect(VARKHUL_FORGE_BEAM_IDLE_COOLING_PER_SECOND_NORMAL).toBe(0.03);
    expect(varkhulForgeBeamOverheatAfterTick(0.4, 'normal', 0, 0, 1)).toBeCloseTo(0.37, 8);
    expect(varkhulForgeBeamOverheatAfterTick(0.4, 'heroic', 0, 0, 1)).toBe(0.4);
  });

  it('lets blocked Normal beams cool while blocked Heroic beams only stop heating', () => {
    expect(varkhulForgeBeamOverheatAfterTick(0.4, 'normal', 2, 0, 1)).toBeCloseTo(0.52, 8);
    expect(varkhulForgeBeamOverheatAfterTick(0.4, 'normal', 2, 1, 1)).toBeCloseTo(0.44, 8);
    expect(varkhulForgeBeamOverheatAfterTick(0.4, 'normal', 2, 2, 1)).toBeCloseTo(0.36, 8);
    expect(varkhulForgeBeamOverheatAfterTick(0.4, 'heroic', 2, 0, 1)).toBeCloseTo(0.52, 8);
    expect(varkhulForgeBeamOverheatAfterTick(0.4, 'heroic', 2, 1, 1)).toBeCloseTo(0.46, 8);
    expect(varkhulForgeBeamOverheatAfterTick(0.4, 'heroic', 2, 2, 1)).toBe(0.4);
    expect(varkhulForgeBeamOverheatAfterTick(0.98, 'normal', 2, 0, 1)).toBe(1);
    expect(varkhulForgeBeamOverheatAfterTick(0.01, 'normal', 2, 2, 1)).toBe(0);
  });

  it('pins healer pressure and the forge meltdown damage profile', () => {
    expect(VARKHUL_FORGE_BEAM_BLOCK_DAMAGE_TICK_SECONDS).toBe(1);
    expect(varkhulForgeBeamBlockDamageMaxHp('normal', 1)).toBe(0.07);
    expect(varkhulForgeBeamBlockDamageMaxHp('normal', 3)).toBeCloseTo(0.11, 8);
    expect(varkhulForgeBeamBlockDamageMaxHp('heroic', 1)).toBe(0.1);
    expect(varkhulForgeBeamBlockDamageMaxHp('heroic', 3)).toBeCloseTo(0.16, 8);
    expect(varkhulForgeBeamExposureResetSeconds('normal')).toBe(10);
    expect(varkhulForgeBeamExposureResetSeconds('heroic')).toBe(60);
    expect(varkhulForgeMeltdownInitialDamageMaxHp('normal')).toBe(0.65);
    expect(varkhulForgeMeltdownInitialDamageMaxHp('heroic')).toBe(0.75);
    expect(VARKHUL_FORGE_MELTDOWN_TICK_SECONDS).toBe(1);
    expect(VARKHUL_FORGE_MELTDOWN_DURATION_SECONDS).toBe(5);
    expect(varkhulForgeMeltdownTickDamageMaxHp('normal')).toBe(0.15);
    expect(varkhulForgeMeltdownTickDamageMaxHp('heroic')).toBe(0.2);
  });

  it('adds eight Normal or ten Heroic forge-heat points when a Crucible Quake resolves', () => {
    expect(VARKHUL_FORGE_QUAKE_OVERHEAT).toBe(0.08);
    expect(varkhulForgeOverheatAfterQuake(0.4, 'normal')).toBeCloseTo(0.48, 8);
    expect(varkhulForgeOverheatAfterQuake(0.4, 'heroic')).toBeCloseTo(0.5, 8);
    expect(varkhulForgeOverheatAfterQuake(0.97, 'heroic')).toBe(1);
  });
});
