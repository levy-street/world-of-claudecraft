// Pure decision for the combat-log message an aura-GAIN SimEvent produces for an
// entity OTHER than the player (the hud.ts 'aura' case). Kept host-agnostic (no
// DOM, no i18n runtime) so the harmful-vs-beneficial call is unit-testable without
// a HUD harness, following the pure-core pattern used across src/ui/*_view.ts.
//
// The SimEvent itself only carries {targetId, name, gained, auraKind?}, no value,
// so the caller looks up the live Aura the event just applied on the target's
// aura list (matched by name, and by kind when the event supplies one) and passes
// its kind/value in here. That reuses the SAME classifier the debuff-bar split
// and /targetbuffs use (src/sim/aura_classify.ts) instead of inventing a second
// harmful/beneficial rule that could drift from it.
import { isDebuffAura } from '../sim/aura_classify';
import type { Aura, AuraKind } from '../sim/types';

export type AuraGainLogKey = 'hud.combat.auraAfflicted' | 'hud.combat.auraGainOther';

/**
 * `matchedAura` is the live Aura found on the target (name/kind matched at the
 * moment the event is handled). When no live aura can be found (e.g. it already
 * expired before the event drained), `fallbackKind` -- the SimEvent's own optional
 * `auraKind` -- still resolves every kind except a negative-value `buff_*` reuse,
 * since only that case needs the real value to break the tie; absent both, the
 * gain reads as neutral rather than assumed harmful.
 */
export function auraGainLogKeyFor(
  matchedAura: Pick<Aura, 'kind' | 'value'> | undefined,
  fallbackKind?: AuraKind,
): AuraGainLogKey {
  const kind = matchedAura?.kind ?? fallbackKind;
  if (kind === undefined) return 'hud.combat.auraGainOther';
  const value = matchedAura?.value ?? 0;
  return isDebuffAura(kind, value) ? 'hud.combat.auraAfflicted' : 'hud.combat.auraGainOther';
}

/** Finds the live aura a just-applied SimEvent refers to on the target's aura
 * list, matched by name (and by kind too when the event carries one, since a
 * target can in principle hold two same-named auras from different sources). */
export function findAuraForGainEvent<T extends Pick<Aura, 'name' | 'kind'>>(
  auras: readonly T[],
  name: string,
  auraKind?: AuraKind,
): T | undefined {
  return auras.find((a) => a.name === name && (auraKind === undefined || a.kind === auraKind));
}
