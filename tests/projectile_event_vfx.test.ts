import { describe, expect, it, vi } from 'vitest';
import type { SimEvent } from '../src/sim/types';
import { handleProjectileEventVfx } from '../src/render/projectile_event_vfx';

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
      expect(vfx.ballisticImpact).toHaveBeenCalledWith(
        '7:12:0',
        9,
        expect.any(Number),
        11,
        reason,
      );
    },
  );

  it('leaves unrelated events for the rest of the renderer event pipeline', () => {
    const vfx = projectileEventVfx();
    const event: SimEvent = { type: 'levelup', level: 2 };

    expect(handleProjectileEventVfx(event, () => 42, vfx)).toBe(false);
    expect(vfx.ballisticProjectile).not.toHaveBeenCalled();
    expect(vfx.ballisticImpact).not.toHaveBeenCalled();
  });
});
