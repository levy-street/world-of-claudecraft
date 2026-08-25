import type { SimEvent } from '../sim/types';
import { groundHeight } from '../sim/world';
import type { BallisticProjectileAppearance, Vfx } from './vfx';

type ProjectileEvent = Extract<
  SimEvent,
  { type: 'projectileLaunch' } | { type: 'projectileImpact' }
>;

interface BallisticAbilityVfx {
  handleBallisticLaunch(
    event: Extract<SimEvent, { type: 'projectileLaunch' }>,
  ): BallisticProjectileAppearance | undefined;
  handleBallisticImpact(event: Extract<SimEvent, { type: 'projectileImpact' }>): void;
}

/** Paints server-authored ballistic travel and impact events. */
export function handleProjectileEventVfx(
  event: SimEvent,
  getSeed: () => number,
  vfx: Pick<Vfx, 'ballisticProjectile' | 'ballisticImpact'>,
  abilityVfx?: BallisticAbilityVfx,
): event is ProjectileEvent {
  if (event.type === 'projectileLaunch') {
    const seed = getSeed();
    const appearance = abilityVfx?.handleBallisticLaunch(event);
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
      appearance,
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
      event.reason,
    );
    abilityVfx?.handleBallisticImpact(event);
    return true;
  }
  return false;
}
