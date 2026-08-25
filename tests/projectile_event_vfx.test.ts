import { describe, expect, it, vi } from 'vitest';
import { handleProjectileEventVfx } from '../src/render/projectile_event_vfx';
import type { SimEvent } from '../src/sim/types';

function projectileEventVfx() {
  return {
    ballisticProjectile: vi.fn(),
    ballisticImpact: vi.fn(),
  };
}

describe('handleProjectileEventVfx', () => {
  it('starts a straight visual from the authoritative launch trajectory', () => {
    const vfx = projectileEventVfx();
    const event: SimEvent = {
      type: 'projectileLaunch',
      trajectoryId: '7:12:0',
      sourceId: 7,
      x: 3,
      z: 5,
      dirX: 0.6,
      dirZ: 0.8,
      speed: 26,
      maxDistance: 35,
      radius: 0.2,
      school: 'physical',
    };

    expect(handleProjectileEventVfx(event, () => 42, vfx)).toBe(true);
    expect(vfx.ballisticProjectile).toHaveBeenCalledWith(
      '7:12:0',
      3,
      expect.any(Number),
      5,
      0.6,
      0.8,
      26,
      35,
      'physical',
      undefined,
    );
  });

  it('threads an authored ability appearance into ballistic travel', () => {
    const vfx = projectileEventVfx();
    const appearance = {
      color: 0x72cfff,
      scale: 1.2,
      jagged: true,
      coils: true,
    };
    const abilityVfx = {
      handleBallisticLaunch: vi.fn(() => appearance),
      handleBallisticImpact: vi.fn(),
    };
    const event: SimEvent = {
      type: 'projectileLaunch',
      trajectoryId: '9:4:0',
      sourceId: 9,
      x: 1,
      z: 2,
      dirX: 0,
      dirZ: 1,
      speed: 26,
      maxDistance: 30,
      radius: 0.2,
      school: 'nature',
      ability: 'lightning_bolt',
    };

    expect(handleProjectileEventVfx(event, () => 42, vfx, abilityVfx)).toBe(true);
    expect(abilityVfx.handleBallisticLaunch).toHaveBeenCalledWith(event);
    expect(vfx.ballisticProjectile).toHaveBeenCalledWith(
      '9:4:0',
      1,
      expect.any(Number),
      2,
      0,
      1,
      26,
      30,
      'nature',
      appearance,
    );
  });

  it.each(['entity', 'wall', 'range', 'sourceDespawn'] as const)(
    'preserves the authoritative %s impact reason for distinct feedback',
    (reason) => {
      const vfx = projectileEventVfx();
      const event: SimEvent = {
        type: 'projectileImpact',
        trajectoryId: '7:12:0',
        x: 9,
        z: 11,
        reason,
      };

      expect(handleProjectileEventVfx(event, () => 42, vfx)).toBe(true);
      expect(vfx.ballisticImpact).toHaveBeenCalledWith('7:12:0', 9, expect.any(Number), 11, reason);
    },
  );

  it('ends the authored sequence at the authoritative impact', () => {
    const vfx = projectileEventVfx();
    const abilityVfx = {
      handleBallisticLaunch: vi.fn(),
      handleBallisticImpact: vi.fn(),
    };
    const event: SimEvent = {
      type: 'projectileImpact',
      trajectoryId: '9:4:0',
      x: 8,
      z: 13,
      targetId: 17,
      reason: 'entity',
    };

    expect(handleProjectileEventVfx(event, () => 42, vfx, abilityVfx)).toBe(true);
    expect(abilityVfx.handleBallisticImpact).toHaveBeenCalledWith(event);
  });

  it('leaves unrelated events for the rest of the renderer event pipeline', () => {
    const vfx = projectileEventVfx();
    const event: SimEvent = { type: 'levelup', level: 2 };

    expect(handleProjectileEventVfx(event, () => 42, vfx)).toBe(false);
    expect(vfx.ballisticProjectile).not.toHaveBeenCalled();
    expect(vfx.ballisticImpact).not.toHaveBeenCalled();
  });
});
