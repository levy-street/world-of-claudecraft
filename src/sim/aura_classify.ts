// Single source of truth for "is this aura a debuff?" — shared by the HUD buff/
// debuff split and the sim's /targetbuffs aura tagging. Host-agnostic (no DOM, no
// i18n), so it lives in src/sim/ and both src/ui/hud.ts and src/sim/sim.ts import
// it. Keeping ONE classifier avoids the drift where the HUD treated silence/disarm/
// blind/etc. as debuffs but /targetbuffs (a narrower set) tagged them as buffs.
import { isUnbreakableControlAura } from './combat/cc';
import type { Aura, AuraKind } from './types';

// A kind that is harmful by nature regardless of its value. Mirrors classic-era
// "Debuff" framing: damage-over-time, crowd control, stat/armor reductions, and
// the various combat penalties (silence/disarm/blind/lockout/expose/...).
export const DEBUFF_AURA_KINDS: ReadonlySet<AuraKind> = new Set<AuraKind>([
  'dot',
  'forced_move',
  'slow',
  'root',
  'stun',
  'incapacitate',
  'polymorph',
  'attackspeed',
  'bleed_vuln',
  'vuln_source',
  'debuff_ap',
  'sunder',
  'corrode',
  'faerie_fire',
  'melting_acid',
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
  'ruinous_brand',
  'duskfire_claim',
  'critvuln',
  'sated', // shared Bloodlust / Temporal Acceleration exhaustion lockout
  'cauterize_fatigue', // Cauterize's 5 min "already saved you" lockout
  'sun_verdict',
  'affliction_eye',
  'affliction_eye_secondary',
  'affliction_violence',
  'necromancy_harvest_mark',
  // Cosmetic and mechanically inert (value 0, no stat fold): listed here only so
  // the countdown sorts into the debuff bar rather than sitting among the buffs.
  'cheater_mark',
]);

// A negative-value stat aura (e.g. a mob's Withering Wail sapping attack power, or
// an Intellect-draining curse) is a debuff even though it reuses a buff_* kind.
export function isDebuffAura(kind: AuraKind, value: number): boolean {
  return DEBUFF_AURA_KINDS.has(kind) || (kind.startsWith('buff_') && value < 0);
}

// Auras that ride a shared, mostly-buff kind ('internal_cd': Heating Up,
// Convergence Mark, Warspirit Cadence, and a dozen other class-specific
// cooldown/proc-window markers) but should be presented on the debuff surface.
// This is VISUAL ONLY. It must not make the aura a player-removable harmful
// effect for dispel, cleanseSelf, or right-click cancel classification.
// Player feedback on PR #3668: Stormsurge's 6 sec "Ancestral Strike's cooldown
// was just reset, and it cannot happen again until you use it and it goes back
// on cooldown" marker (shaman_warspirit.ts STORMSURGE_READY_ID) read as a buff,
// which hid it behind the buff bar's low-tier overflow cap alongside ordinary
// stat buffs even though missing it costs the player a timing window, not just
// a cosmetic icon.
const DEBUFF_DISPLAY_AURA_IDS: ReadonlySet<string> = new Set(['shaman_stormsurge_ready']);

export function isDebuffDisplayAura(kind: AuraKind, value: number, id?: string): boolean {
  return isDebuffAura(kind, value) || (id !== undefined && DEBUFF_DISPLAY_AURA_IDS.has(id));
}

// The one rule for "may a player counter take this aura off at all", ahead of any
// question of school or polarity. Three aura classes answer no: encounter-owned
// mechanics, unbreakable control (the script owns its release), and `undispellable` penalties
// (the recovery sicknesses, which only their own timer clears). Every removal path a
// player can drive routes through here so the answer cannot drift between them: the
// dispel executor and its requiresDispellable cast gate (isDispellableAura below),
// the cleanseSelf executor (combat/effect_dispatch.ts), and the right-click buff
// cancel (combat/aura_cancel.ts).
export function isPlayerRemovableAura(
  aura: Pick<Aura, 'kind' | 'unbreakableControl' | 'encounterOwned' | 'undispellable'>,
): boolean {
  return (
    aura.encounterOwned !== true && !isUnbreakableControlAura(aura) && aura.undispellable !== true
  );
}

// The dispel eligibility rule, shared by the dispel executor and the
// requiresDispellable cast gate so the two can never drift: player-removable and
// magic-school only, and the cast's direction picks the polarity (an OFFENSIVE dispel
// strips a benefit off an enemy; a friendly one strips a harmful effect off an ally).
export function isDispellableAura(
  aura: Pick<Aura, 'kind' | 'value' | 'school'> &
    Partial<
      Pick<Aura, 'id' | 'unbreakableControl' | 'encounterOwned' | 'undispellable' | 'permanent'>
    >,
  offensive: boolean,
): boolean {
  // Ascension is a player-owned resource state surfaced as an aura for HUD clarity,
  // not a transferable magic buff. Letting dispel/steal remove only the synthetic
  // icon would leave its charges active invisibly (or copy a mechanically inert icon).
  if (aura.id === 'divine_ascension' || aura.permanent) return false;
  if (aura.id !== undefined && DEBUFF_DISPLAY_AURA_IDS.has(aura.id)) return false;
  if (!isPlayerRemovableAura(aura)) return false;
  if (aura.school === 'physical') return false;
  const harmful = isDebuffAura(aura.kind, aura.value);
  return offensive ? !harmful : harmful;
}

const PARTY_FRAME_HELPFUL_KINDS: ReadonlySet<AuraKind> = new Set<AuraKind>([
  'temporal_echo',
  'beacon_of_light',
  'hot',
  'absorb',
  'cast_shield',
  'heal_echo',
  'buff_dr',
  'buff_maxhp_pct',
  'stasis',
]);

// Evasion and Deterrence share buff_dodge with long-lived maintenance buffs, so
// their stable ability ids distinguish the major defensives from passive upkeep.
const PARTY_FRAME_HELPFUL_IDS: ReadonlySet<string> = new Set([
  'evasion',
  'deterrence',
  'priest_doctrine',
]);

// Kinds a party/raid frame never shows, ahead of the debuff arm that would
// otherwise pull them in and sort them tier 0 in partyAuraPriority
// (combat/chronomancy.ts). A raid frame caps the auras it draws, so anything
// listed here would push a real dispellable debuff off a healer's frame:
//  - 'sated': the Bloodlust exhaustion lockout, which no healer acts on.
//  - 'cheater_mark': the operator-applied sanction. It is deliberately
//    power-neutral (src/sim/moderation/CLAUDE.md), and costing the marked
//    player's healer a raid-frame slot is exactly the kind of information
//    handicap that rule forbids. Its render surfaces are the nameplate and the
//    target frame, which is where the tag is meant to be read.
const PARTY_FRAME_EXCLUDED_KINDS: ReadonlySet<AuraKind> = new Set<AuraKind>([
  'sated',
  'cheater_mark',
]);

/** Effects worth surfacing on a compact party/raid frame. Generic maintenance
 * buffs, forms, stances, and personal damage procs remain on the normal aura UI. */
export function isPartyFrameRelevantAura(aura: {
  id: string;
  kind: AuraKind;
  value?: number;
  neg?: 1;
}): boolean {
  if (PARTY_FRAME_EXCLUDED_KINDS.has(aura.kind)) return false;
  const value = aura.neg ? -1 : (aura.value ?? 1);
  // Deliberately the harmful classifier, not isDebuffDisplayAura: a display override is a
  // personal proc/cooldown marker no healer acts on, exactly like 'sated' and
  // 'cheater_mark' above, which PARTY_FRAME_EXCLUDED_KINDS already keeps off a
  // raid frame despite being real debuffs. Passing the id here would newly spend
  // a raid frame's limited aura slots on it.
  return (
    isDebuffAura(aura.kind, value) ||
    PARTY_FRAME_HELPFUL_KINDS.has(aura.kind) ||
    PARTY_FRAME_HELPFUL_IDS.has(aura.id)
  );
}
