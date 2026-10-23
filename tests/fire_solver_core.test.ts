import { describe, expect, it } from 'vitest';
import {
  FIRE_VOLUME_ENTER_PIXELS,
  FIRE_VOLUME_EXIT_PIXELS,
  fireAtlasTexelToVoxel,
  fireCombustStep,
  fireDraftPulse,
  firePlanForTier,
  fireVoxelToAtlasTexel,
  shouldUseFireVolume,
} from '../src/render/fire/fire_solver_core';

describe('fire solver tier plan', () => {
  it('selects valid 3D grids and tiling layouts for every supported tier', () => {
    expect(firePlanForTier('nonsense' as never)).toBeNull();
    for (const tier of ['low', 'medium', 'high', 'ultra', 'insane'] as const) {
      const plan = firePlanForTier(tier);
      expect(plan).not.toBeNull();
      if (!plan) continue;
      expect(plan.gridXZ).toBeGreaterThanOrEqual(24);
      expect(plan.gridY).toBeGreaterThan(plan.gridXZ);
      expect(plan.tilesX * plan.tilesZ).toBe(plan.gridXZ);
      expect(plan.atlasWidth).toBe(plan.gridXZ * plan.tilesX);
      expect(plan.atlasHeight).toBe(plan.gridY * plan.tilesZ);
      expect(plan.jacobiIterations).toBeGreaterThanOrEqual(5);
      expect(plan.marchSteps).toBeGreaterThanOrEqual(14);
    }
    expect(firePlanForTier('low')?.shimmerStrength).toBe(0);
    expect(firePlanForTier('medium')?.shimmerStrength).toBe(0);
    expect(firePlanForTier('high')?.shimmerStrength).toBeGreaterThan(0);
    expect(firePlanForTier('ultra')?.shimmerStrength).toBeGreaterThan(0);
    expect(firePlanForTier('insane')?.shimmerStrength).toBeGreaterThan(0);
  });
});

describe('fire volume LOD hysteresis', () => {
  it('switches into and out of volumetric ray-marching with a clean deadband', () => {
    expect(FIRE_VOLUME_EXIT_PIXELS).toBeLessThan(FIRE_VOLUME_ENTER_PIXELS);
    expect(shouldUseFireVolume(12, false)).toBe(false);
    expect(shouldUseFireVolume(17, false)).toBe(false);
    expect(shouldUseFireVolume(18, false)).toBe(true);
    expect(shouldUseFireVolume(16, true)).toBe(true);
    expect(shouldUseFireVolume(14, true)).toBe(true);
    expect(shouldUseFireVolume(13.9, true)).toBe(false);
  });
});

describe('3D slice atlas address bijection', () => {
  it('round-trips every interior voxel through the 2D slice atlas without loss', () => {
    const plan = firePlanForTier('high');
    if (!plan) throw new Error('high tier must have a plan');
    for (let vz = 0; vz < plan.gridXZ; vz += 5) {
      for (let vy = 0; vy < plan.gridY; vy += 9) {
        for (let vx = 0; vx < plan.gridXZ; vx += 5) {
          const { px, py } = fireVoxelToAtlasTexel(vx, vy, vz, plan);
          expect(px).toBeGreaterThanOrEqual(0);
          expect(px).toBeLessThan(plan.atlasWidth);
          expect(py).toBeGreaterThanOrEqual(0);
          expect(py).toBeLessThan(plan.atlasHeight);
          const roundTrip = fireAtlasTexelToVoxel(px, py, plan);
          expect(roundTrip).toEqual({ vx, vy, vz });
        }
      }
    }
  });
});

describe('combustion and buoyancy step (CPU mirror of GPU solver)', () => {
  it('pulses the burner draft strictly inside [0.72, 1.28]', () => {
    for (let t = 0; t < 20; t += 0.17) {
      for (const seed of [0, 1.3, 7.9, 42.1]) {
        const pulse = fireDraftPulse(t, seed);
        expect(pulse).toBeGreaterThanOrEqual(0.72);
        expect(pulse).toBeLessThanOrEqual(1.28);
      }
    }
  });

  it('consumes fuel into temperature and accelerates upward buoyancy in the flame core', () => {
    const state = {
      fuel: 0.9,
      temperature: 1.0,
      smoke: 0.05,
      vy: 0.2,
    };
    const next = fireCombustStep(state, 1 / 60);
    // Fuel burns down while releasing exothermic heat and driving upward velocity.
    expect(next.fuel).toBeLessThan(state.fuel);
    expect(next.temperature).toBeGreaterThan(state.temperature * 0.98);
    expect(next.vy).toBeGreaterThan(state.vy);
    expect(next.smoke).toBeGreaterThan(state.smoke);
  });

  it('radiatively cools an unrefuelled hot parcel and decays smoke over time', () => {
    const state = {
      fuel: 0,
      temperature: 1.4,
      smoke: 0.8,
      vy: 1.1,
    };
    const next = fireCombustStep(state, 1 / 30);
    expect(next.temperature).toBeLessThan(state.temperature);
    expect(next.smoke).toBeLessThan(state.smoke);
  });
});
