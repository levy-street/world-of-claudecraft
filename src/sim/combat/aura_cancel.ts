// Player-initiated buff cancellation ("right-click a buff to remove it").
//
// Pure, host-agnostic decision logic shared by the offline Sim (which mutates the
// authoritative aura array) and the HUD (which decides which icons expose the
// right-click affordance).
import { isDebuffAura as classifyDebuffAura, isPlayerRemovableAura } from '../aura_classify';
import { DIVINE_ASCENSION_AURA_ID } from '../paladin_devotion';
import type { Aura } from '../types';

type CancelableAura = Pick<Aura, 'id' | 'kind' | 'value'> &
  Partial<Pick<Aura, 'sourceId' | 'unbreakableControl' | 'undispellable'>>;

// A debuff is anything in the harmful set, OR a stat aura riding a `buff_*` kind
// with a negative value (an enfeeble / wither drain reuses a buff_* kind but saps
// the stat). Display-only debuff styling does not count here.
export function isDebuffAura(a: CancelableAura): boolean {
  return classifyDebuffAura(a.kind, a.value);
}

// `internal_cd` almost always rides hidden engine bookkeeping (applyStateAura in
// combat/hunter_shared.ts and its siblings across every class: an internal
// cooldown gating a proc/burst re-trigger, a rotation counter, a ready state), not
// a buff the player carries. It defaults to isDebuffAura false (it is in neither
// DEBUFF_AURA_KINDS nor a negative buff_*), so a player could right-click one away
// the instant it landed and re-trigger the burst/proc it protects on demand,
// defeating the gate entirely (reported: Hunter Enduring Courser's 20s ICD
// stripped to farm its 3s/60% movement-speed burst at 100% uptime in arena/BG).
// A rare few `internal_cd` auras ARE a genuine player-facing resource window with
// their own bespoke Sim.cancelAura teardown (Divine Ascension unwinds
// paladinDevotion.ascensionCharges/Remaining alongside the aura): list those here
// explicitly, opt-in, rather than reopening the kind to every silent gate.
const CANCELABLE_INTERNAL_CD_IDS: ReadonlySet<string> = new Set([DIVINE_ASCENSION_AURA_ID]);

// A player may voluntarily cancel any helpful aura they carry; debuffs never. The
// classic right-click-cancel includes forms, stances, and stealth (canceling a
// form aura reverts to caster form) since none of those are harmful. The
// player-removable test is the same one the dispel and cleanse executors answer to,
// so an aura no counter may shed is no more cancelable than it is dispellable.
export function isCancelableAura(a: CancelableAura): boolean {
  return (
    a.id !== 'beacon_of_light' &&
    a.id !== 'veilbound_march' &&
    (a.kind !== 'internal_cd' || CANCELABLE_INTERNAL_CD_IDS.has(a.id)) &&
    isPlayerRemovableAura(a) &&
    !isDebuffAura(a)
  );
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
export function removeCancelableAura(
  auras: Aura[],
  auraId: string,
  sourceId?: number,
): Aura | null {
  const idx = auras.findIndex(
    (a) =>
      a.id === auraId && (sourceId === undefined || a.sourceId === sourceId) && isCancelableAura(a),
  );
  if (idx < 0) return null;
  const [removed] = auras.splice(idx, 1);
  return removed;
}
