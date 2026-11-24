// Oakhide (barkskin): a flat damage reduction (buff_dr, 25% for 15 sec) whose
// instances OVERLAP. A Nature's Boon proc resets Oakhide's cooldown
// (combat/druid_natures_boon.ts), so a second Oakhide can land while the first
// is still running; the second rides its own aura id so applyAura does not
// treat it as a refresh of the first, and the two reductions add in
// combat/damage.ts like every other buff_dr (two base copies: 50%).
//
// A leaf module: no class engine imports, nothing here draws rng.

import type { Entity } from '../types';

export const OAKHIDE_ID = 'barkskin';
/** The aura id an Oakhide cast takes while another is already running. */
export const OAKHIDE_OVERLAP_ID = 'barkskin_overlap';

/** The aura id this Oakhide cast should apply under: the bare id when no copy
 *  of the caster's own is up, the overlap id when one is, and with both up the
 *  copy closer to expiring is the one refreshed. Every other ability keeps the
 *  id it was handed. */
export function oakhideAuraId(caster: Pick<Entity, 'auras' | 'id'>, auraId: string): string {
  if (auraId !== OAKHIDE_ID) return auraId;
  const own = (id: string) =>
    caster.auras.find((aura) => aura.id === id && aura.sourceId === caster.id);
  const first = own(OAKHIDE_ID);
  if (!first) return OAKHIDE_ID;
  const second = own(OAKHIDE_OVERLAP_ID);
  if (!second) return OAKHIDE_OVERLAP_ID;
  return first.remaining <= second.remaining ? OAKHIDE_ID : OAKHIDE_OVERLAP_ID;
}
