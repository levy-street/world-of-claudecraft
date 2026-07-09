// Player-initiated buff cancellation ("right-click a buff to remove it").
//
// Pure, host-agnostic decision logic shared by the offline Sim (which mutates the
// authoritative aura array) and the HUD (which decides which icons render as a
// debuff and which expose the right-click affordance). Keeping the classification
// in one leaf means "rendered as a helpful buff" and "right-click cancelable" are
// provably the same set and can never drift apart.
import type { Aura, AuraKind } from '../types';

// Every aura kind that works AGAINST its bearer. This is the broad, player-facing
// debuff set (the inverse of "helpful buff"), deliberately wider than the narrow
// `isHarmfulAura` in sim.ts used only for the /targetbuffs cosmetic tag: it MUST
// include the hard-CC and silence family so a player can never right-click a
// silence, hex, or disarm off themselves (that would be a free CC break).
const DEBUFF_KINDS: ReadonlySet<AuraKind> = new Set<AuraKind>([
  'dot',
  'slow',
  'root',
  'stun',
  'incapacitate',
  'polymorph',
  'attackspeed',
  'debuff_ap',
  'sunder',
  'corrode',
  'faerie_fire',
  'mortal_wound',
  'silence',
  'disarm',
  'blind',
  'expose',
  'spellvuln',
  'lockout',
  'vulnerability',
  'hex',
  'tongues',
  'cost_tax',
  'heal_absorb',
  'critvuln',
]);

// A debuff is anything in the harmful set, OR a stat aura riding a `buff_*` kind
// with a negative value (an enfeeble / wither drain reuses a buff_* kind but saps
// the stat). Mirrors the HUD's buff-vs-debuff styling test.
export function isDebuffAura(a: Aura): boolean {
  return DEBUFF_KINDS.has(a.kind) || (a.kind.startsWith('buff_') && a.value < 0);
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
