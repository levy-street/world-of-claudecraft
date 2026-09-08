import type { SimEvent } from '../sim/types';
import type { CharacterVisual } from './characters/visual';

/** Healing marks use the same throttled contact as their existing bloom.
 * Missing views never consume the target's next visible contact. */
export function showHealingContact(
  event: Extract<SimEvent, { type: 'heal2' }>,
  visible: boolean,
  lastContact: Map<number, number>,
  bloom: (id: number) => void,
  visual: CharacterVisual | null,
  detailed: boolean,
): void {
  if (!(event.amount > 0 || event.crit) || !visible) return;
  const now = performance.now();
  if (now - (lastContact.get(event.targetId) ?? 0) < 110) return;
  lastContact.set(event.targetId, now);
  bloom(event.targetId);
  if (detailed && !event.hot)
    visual?.respondToElement(
      [
        'holy_light',
        'dawns_embrace',
        'radiant_chorus',
        'solar_invocation',
        'mercy_lance',
        'aegis_first_dawn',
        'Mending Light',
        "Dawn's Embrace",
        'Radiant Chorus',
        'Solar Invocation',
        'Mercy Lance',
        'Aegis of the First Dawn',
      ].includes(event.abilityId ?? event.ability)
        ? 'holy-heal'
        : 'heal',
      0.65,
    );
}
