import type { AbilityVfxFx } from './fx';
import type { AbilityVfxDamageEvent } from './painter';

// Cosmetic alternation only. One entry per engine, released with that engine;
// no actor history or timer can survive a missing recipient or invent a hit.
const echoBeat = new WeakMap<AbilityVfxFx, number>();

/** Cadence echoes are resolved weapon sub-beats, never fresh cast performances. */
export function shamanWeaponProc(
  fx: AbilityVfxFx,
  ev: AbilityVfxDamageEvent,
  isShaman: ((source: number) => boolean) | undefined,
): boolean {
  if (
    ev.abilityId != null ||
    (ev.ability !== 'Galeheart Echo' && ev.ability !== 'Living Weapon') ||
    ev.school !== 'nature' ||
    !isShaman?.(ev.sourceId)
  )
    return false;
  if (ev.kind !== 'hit' && ev.kind !== 'block') return true;
  const damage = ev.amount > 0;
  if (!damage && !((ev.absorbed ?? 0) > 0)) return true;
  const target = fx.anchorOf(ev.targetId, 0.57);
  if (!target) return true;
  // Snapshot the receiver before resolving the source. Never fall back to the
  // caster, and never borrow another nearby actor when a view is unavailable.
  const x = target.x,
    y = target.y,
    z = target.z;
  if (!damage) {
    fx.burstAt(x, y, z, 0xd9eff0, 3, 0.16, 'sparks', 0.13);
    return true;
  }
  const source = fx.anchorOf(ev.sourceId, 0.57);
  const dx = source ? x - source.x : 0;
  const dz = source ? z - source.z : 1;
  const distance = Math.hypot(dx, dz) || 1;
  const sx = dz / distance,
    sz = -dx / distance;
  const beat = echoBeat.get(fx) ?? 0;
  echoBeat.set(fx, 1 - beat);
  const sign = beat === 0 ? 1 : -1;
  const reach = ev.ability === 'Living Weapon' ? 0.63 : 0.8;
  // One open, tapered wind stroke per real echo. Two synchronous echoes cross
  // at the wound; they do not restart the weapon animation or shake the camera.
  fx.pathRibbon(
    0x81b6bb,
    0.065,
    0.19,
    (points) => {
      for (let i = 0; i < 12; i++) {
        const u = i / 11;
        const across = (u - 0.5) * reach * 2;
        const bow = Math.sin(u * Math.PI) * reach * 0.2;
        points[i].set(
          x + sx * across + (dx / distance) * bow,
          y + across * sign * 0.5,
          z + sz * across + (dz / distance) * bow,
        );
      }
      return 12;
    },
    false,
    null,
    true,
  );
  fx.burstAt(x, y, z, 0xe7f6df, 4, 0.24, 'sparks', 0.18);
  return true;
}
