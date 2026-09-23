import type { AbilityVfxFx } from './fx';
import type { AbilityVfxSpellfxEvent } from './painter';
import type { ShamanHealEvent } from './shaman_events';

const CURRENT = 'shaman_mending_current';
type Host = Pick<AbilityVfxFx, 'anchorOf' | 'burstAt'>;

/** Reservoir bookkeeping is not another cast impact. The tagged producer
 * distinguishes it from another class's ward, even on the same recipient. */
export function shamanCurrentSpell(fx: Host, ev: AbilityVfxSpellfxEvent): boolean {
  if (ev.ability !== CURRENT || (ev.fx !== 'wardBloom' && ev.fx !== 'echoBurst')) return false;
  if (ev.fx === 'wardBloom') {
    const at = fx.anchorOf(ev.targetId, 0.4);
    if (at) fx.burstAt(at.x, at.y, at.z, 0x86e1d4, 9, 0.25, 'shaman_droplets', 0.38);
  }
  // Harvest's real heal already owns the receiving cue.
  return true;
}

export function shamanCurrentHeal(
  fx: Host,
  ev: ShamanHealEvent,
  isShaman?: (id: number) => boolean,
): boolean {
  const current =
    ev.abilityId === CURRENT ||
    (ev.abilityId === undefined && ev.ability === 'Mending Current' && isShaman?.(ev.sourceId));
  if (!current) return false;
  if (!ev.cueOnly && ev.amount > 0) {
    const at = fx.anchorOf(ev.targetId, 0.58);
    if (at) fx.burstAt(at.x, at.y, at.z, 0xbdece0, 7, 0.2, 'shaman_runoff', 0.42);
  }
  return true;
}
