import { describe, expect, it } from 'vitest';
import {
  casterShadowMayReachCamera,
  residentSceneMayReachRenderVolumes,
  SHADOW_VISIBILITY_MARGIN,
} from '../src/render/resident_scenery_core';

const camera = {
  position: { x: 0, y: 5, z: 0 },
  forward: { x: 0, y: 0, z: 1 },
  near: 0.1,
} as const;

describe('resident scenery visibility policy', () => {
  it('retains a caster that reaches the camera half-space', () => {
    expect(
      casterShadowMayReachCamera({ x: 0, y: 0, z: -2, radius: 1.2 }, camera, { x: 0, y: 0, z: 1 }),
    ).toBe(true);
  });

  it('rejects only a behind-camera caster whose shadow travels farther behind', () => {
    expect(
      casterShadowMayReachCamera({ x: 0, y: 0, z: -3, radius: 1 }, camera, { x: 0, y: 0, z: 1 }),
    ).toBe(false);
    expect(
      casterShadowMayReachCamera({ x: 0, y: 0, z: -3, radius: 1 }, camera, { x: 0, y: 0, z: -1 }),
    ).toBe(true);
  });

  it('keeps the filter margin behind the near plane', () => {
    expect(SHADOW_VISIBILITY_MARGIN).toBe(1);
    expect(
      casterShadowMayReachCamera({ x: 0, y: 0, z: -1.5, radius: 0.5 }, camera, {
        x: 0,
        y: 0,
        z: 1,
      }),
    ).toBe(false);
    expect(
      casterShadowMayReachCamera({ x: 0, y: 0, z: -1.3, radius: 0.5 }, camera, {
        x: 0,
        y: 0,
        z: 1,
      }),
    ).toBe(true);
  });

  it('uses the translated camera and all three forward-vector components', () => {
    const third = 1 / 3;
    expect(
      casterShadowMayReachCamera(
        { x: 9, y: 18, z: 28, radius: 1 },
        {
          position: { x: 10, y: 20, z: 30 },
          forward: { x: third, y: 2 * third, z: 2 * third },
          near: 0.1,
        },
        { x: third, y: 2 * third, z: 2 * third },
      ),
    ).toBe(false);
  });

  it('retains a resident scene if either enclosing render volume can reach it', () => {
    const bounds = { x: 100, y: 0, z: 0, radius: 5 };
    expect(
      residentSceneMayReachRenderVolumes(
        bounds,
        { x: 90, y: 0, z: 0 },
        20,
        false,
        { x: 0, y: 0, z: 0 },
        20,
      ),
    ).toBe(true);
    expect(
      residentSceneMayReachRenderVolumes(
        bounds,
        { x: 0, y: 0, z: 0 },
        20,
        true,
        { x: 90, y: 0, z: 0 },
        20,
      ),
    ).toBe(true);
    expect(
      residentSceneMayReachRenderVolumes(
        bounds,
        { x: 0, y: 0, z: 0 },
        20,
        false,
        { x: 90, y: 0, z: 0 },
        20,
      ),
    ).toBe(false);
    expect(
      residentSceneMayReachRenderVolumes(
        bounds,
        { x: 0, y: 0, z: 0 },
        20,
        true,
        { x: 0, y: 0, z: 0 },
        20,
      ),
    ).toBe(false);
  });
});
