// Player-initiated buff cancellation ("right-click a buff to remove it").
//
// Pure, host-agnostic decision logic shared by the offline Sim (which mutates the
// authoritative aura array) and the HUD (which decides which icons render as a
// debuff and which expose the right-click affordance). Keeping the classification
// in one leaf means "rendered as a helpful buff" and "right-click cancelable" are
// provably the same set and can never drift apart.
import { isDebuffAura as classifyDebuffAura } from '../aura_classify';
import type { Aura } from '../types';

// A debuff is anything in the harmful set, OR a stat aura riding a `buff_*` kind
// with a negative value (an enfeeble / wither drain reuses a buff_* kind but saps
// the stat). Mirrors the HUD's buff-vs-debuff styling test.
export function isDebuffAura(a: Aura): boolean {
  return classifyDebuffAura(a.kind, a.value);
}

// A player may voluntarily cancel any helpful aura they carry; debuffs never. The
// classic right-click-cancel includes forms, stances, and stealth (canceling a
// form aura reverts to caster form) since none of those are harmful.
export function isCancelableAura(a: Aura): boolean {
  return !isDebuffAura(a);
}

// Whether removing this aura changes derived stats and so needs a recalc to
// un-fold its contribution (a `buff_*` stat buff or a shapeshift `form_*`). HoTs,
// absorbs, and imbues do not feed recalcPlayerStats, so they need no recalc.
export function auraAffectsStats(a: Aura): boolean {
  return a.kind.startsWith('buff') || a.kind.startsWith('form');
}

// Remove the first cancelable aura matching `auraId` from the array in place and
// return it, or null when no such aura exists or the matched aura is a debuff the
// player may not cancel. Auras are in application order, so "first match" is
// deterministic. The caller emits the fade event and recalcs stats if needed.
export function removeCancelableAura(auras: Aura[], auraId: string): Aura | null {
  const idx = auras.findIndex((a) => a.id === auraId && isCancelableAura(a));
  if (idx < 0) return null;
  const [removed] = auras.splice(idx, 1);
  return removed;
}
