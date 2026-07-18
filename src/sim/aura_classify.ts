// Single source of truth for "is this aura a debuff?" — shared by the HUD buff/
// debuff split and the sim's /targetbuffs aura tagging. Host-agnostic (no DOM, no
// i18n), so it lives in src/sim/ and both src/ui/hud.ts and src/sim/sim.ts import
// it. Keeping ONE classifier avoids the drift where the HUD treated silence/disarm/
// blind/etc. as debuffs but /targetbuffs (a narrower set) tagged them as buffs.
import type { AuraKind } from './types';

// A kind that is harmful by nature regardless of its value. Mirrors classic-era
// "Debuff" framing: damage-over-time, crowd control, stat/armor reductions, and
// the various combat penalties (silence/disarm/blind/lockout/expose/...).
export const DEBUFF_AURA_KINDS: ReadonlySet<AuraKind> = new Set<AuraKind>([
  'dot',
  'slow',
  'root',
  'stun',
  'incapacitate',
  'polymorph',
  'attackspeed',
  'bleed_vuln',
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
  'sated', // shared Bloodlust / Temporal Acceleration exhaustion lockout
  'cauterize_fatigue', // Cauterize's 5 min "already saved you" lockout
]);

// A negative-value stat aura (e.g. a mob's Withering Wail sapping attack power, or
// an Intellect-draining curse) is a debuff even though it reuses a buff_* kind.
export function isDebuffAura(kind: AuraKind, value: number): boolean {
  return DEBUFF_AURA_KINDS.has(kind) || (kind.startsWith('buff_') && value < 0);
}

// The dispel eligibility rule, shared by the dispel executor and the
// requiresDispellable cast gate so the two can never drift: magic-school only,
// and the cast's direction picks the polarity (an OFFENSIVE dispel strips a
// benefit off an enemy; a friendly one strips a harmful effect off an ally).
export function isDispellableAura(
  aura: { kind: AuraKind; value: number; school: string },
  offensive: boolean,
): boolean {
  if (aura.school === 'physical') return false;
  const harmful = isDebuffAura(aura.kind, aura.value);
  return offensive ? !harmful : harmful;
}

const PARTY_FRAME_HELPFUL_KINDS: ReadonlySet<AuraKind> = new Set<AuraKind>([
  'temporal_echo',
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
const PARTY_FRAME_HELPFUL_IDS: ReadonlySet<string> = new Set(['evasion', 'deterrence']);

/** Effects worth surfacing on a compact party/raid frame. Generic maintenance
 * buffs, forms, stances, and personal damage procs remain on the normal aura UI. */
export function isPartyFrameRelevantAura(aura: {
  id: string;
  kind: AuraKind;
  value?: number;
  neg?: 1;
}): boolean {
  if (aura.kind === 'sated') return false;
  const value = aura.neg ? -1 : (aura.value ?? 1);
  return (
    isDebuffAura(aura.kind, value) ||
    PARTY_FRAME_HELPFUL_KINDS.has(aura.kind) ||
    PARTY_FRAME_HELPFUL_IDS.has(aura.id)
  );
}
