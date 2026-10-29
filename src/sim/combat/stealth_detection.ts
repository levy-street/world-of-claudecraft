// Authoritative reveal history, shared by every host. A target ID alone is
// untrusted intent, not evidence that its owner spotted a stealther. Keep only
// living players/pets inside the largest held radius; rebuild from the existing
// nearby grid in the aura phase, never from snapshots or a realm-wide scan.
// Non-stealth players cost one scalar write; only stealthers allocate a Set.
import type { SimContext } from '../sim_context';
import {
  hasPvpEscapeStealth,
  PVP_STEALTH_DETECTION_BASE,
  PVP_STEALTH_DETECTION_HYSTERESIS,
  withinPvpStealthDetection,
} from '../threat';
import type { Entity } from '../types';

export function updatePvpStealthObservers(ctx: SimContext, target: Entity): void {
  if (target.kind !== 'player') return;
  if (target.dead) {
    target.pvpStealthObservers = undefined;
    return;
  }
  if (!target.stealthed) {
    // The normal body was visible before a subsequent stealth entry. Nearby
    // enemies may keep that genuine reveal, even without a combat target lock.
    target.pvpStealthObservers = null;
    return;
  }
  if (hasPvpEscapeStealth(target)) {
    target.pvpStealthObservers = undefined;
    return;
  }
  const previous = target.pvpStealthObservers;
  const next = new Set<number>();
  ctx.grid.forEachInRadius(
    target.pos.x,
    target.pos.z,
    PVP_STEALTH_DETECTION_BASE + PVP_STEALTH_DETECTION_HYSTERESIS,
    (observer) => {
      if (observer.dead || observer.id === target.id || !ctx.entities.has(observer.id)) return;
      if (observer.kind !== 'player' && !(observer.kind === 'mob' && observer.ownerId !== null))
        return;
      const held = previous === null || (previous?.has(observer.id) ?? false);
      if (withinPvpStealthDetection(observer, target, held) && ctx.isHostileTo(observer, target))
        next.add(observer.id);
    },
  );
  target.pvpStealthObservers = next;
}
