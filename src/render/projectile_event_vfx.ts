import type { SimEvent } from '../sim/types';
import { groundHeight } from '../sim/world';
import type { Vfx } from './vfx';

type ProjectileEvent = Extract<
  SimEvent,
  { type: 'projectileLaunch' } | { type: 'projectileImpact' }
>;

/** Paints server-authored ballistic travel and impact events. */
export function handleProjectileEventVfx(
  event: SimEvent,
  getSeed: () => number,
  vfx: Pick<Vfx, 'ballisticProjectile' | 'ballisticImpact'>,
): event is ProjectileEvent {
  if (event.type === 'projectileLaunch') {
    const seed = getSeed();
    vfx.ballisticProjectile(
      event.trajectoryId,
      event.x,
      groundHeight(event.x, event.z, seed) + 0.7,
      event.z,
      event.dirX,
      event.dirZ,
      event.speed,
      event.maxDistance,
      event.school,
    );
    return true;
  }
  if (event.type === 'projectileImpact') {
    const seed = getSeed();
    vfx.ballisticImpact(
      event.trajectoryId,
      event.x,
      groundHeight(event.x, event.z, seed) + 0.7,
      event.z,
      event.reason === 'entity' || event.reason === 'wall',
    );
    return true;
  }
  return false;
}
