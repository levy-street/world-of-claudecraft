import { Vector3 } from 'three';
import type { WeaponAnchorSampler } from '../weapon_trail_anchor';
import { WARRIOR_STORM_TURN_RATE } from './held_warrior_storm';

/** The leading cutting edge follows the displayed weapon, including native
 * animation holds and late channel observation. Equipment searches are bounded. */
export class WarriorStormAnchor {
  private readonly tip = new Vector3();
  private weapon: WeaponAnchorSampler | null = null;
  private retryAt = -Infinity;

  constructor(private readonly entityId: number) {}

  update(
    elapsed: number,
    at: { x: number; y: number; z: number },
    facing: number,
    now: number,
    resolveWeapon?: (id: number, hand: 0 | 1) => WeaponAnchorSampler | null,
  ): number {
    const clock = Number.isFinite(now) ? now : 0;
    if (!this.weapon && clock >= this.retryAt) {
      this.retryAt = clock + 0.35;
      this.weapon = resolveWeapon?.(this.entityId, 0) ?? null;
    }
    if (this.weapon) {
      if (
        this.weapon(this.tip) &&
        Number.isFinite(this.tip.x) &&
        Number.isFinite(this.tip.y) &&
        Number.isFinite(this.tip.z)
      ) {
        const dx = this.tip.x - at.x;
        const dz = this.tip.z - at.z;
        if (Number.isFinite(dx) && Number.isFinite(dz) && dx * dx + dz * dz >= 0.01)
          return Math.atan2(dx, dz) - 2.3;
      }
      this.weapon = null;
      this.retryAt = clock + 0.35;
    }
    return (
      (Number.isFinite(facing) ? facing : 0) +
      (Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0) * WARRIOR_STORM_TURN_RATE -
      2.3
    );
  }
}
