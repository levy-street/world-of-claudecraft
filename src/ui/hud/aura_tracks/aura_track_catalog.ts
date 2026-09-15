// Which track each of the player's own beneficial auras belongs to, derived ONCE
// from the merged ability table rather than hand-listed.
//
// WHY A DERIVED CATALOG AND NOT A LIST. A hand-written list of sixty-odd spell
// ids is a second source of truth that goes stale the day someone adds a heal:
// the new spell silently appears in no track and nobody notices, because nothing
// fails. Deriving from ABILITIES means a new HoT joins its track for free, and
// the pins in tests/aura_track_catalog.test.ts assert the DERIVATION rather than
// a copy of its output, so a rule change has to be argued rather than absorbed.
//
// KEYED BY THE AURA ID THE SIM APPLIES, NOT THE ABILITY ID. The two differ more
// often than a reader expects: an effect can name its own auraId (Raised Guard
// lands as raised_guard_dr, Whirlwind's Bladed Echo as bladed_echo, Hallowed
// Wall's shield as holy_shield_absorb), a second self-buff on one ability is
// kind-suffixed (Arcane Power's haste is arcane_power_buff_spellhaste), and an
// absorb beside a stasis takes _absorb. Those rules live in
// src/sim/combat/aura_ids.ts and the dispatcher calls the same functions, so an
// id computed here is an id a live aura can actually carry. One entry per
// qualifying EFFECT, so Hallowed Wall's block buff and its shield are two rows
// in two tracks. tests/aura_track_catalog.test.ts casts through a real Sim and
// checks every helpful aura it leaves resolves here, which is what keeps the two
// sides honest.
//
// It is built at module load and read as a Map on the frame path, so the
// per-frame cost is a lookup, never a scan of the ability table.
//
// THE DURATION CEILING is what keeps the long buffs out. Everything a track
// shows is 60 seconds or less; the next longest helpful buff in the game is 600
// (Briarguard, Thunder Ward), then 1800 (the raid buffs, aspects, poisons,
// imbues) and 3600 (forms and stances). The cutoff therefore sits in a 10x gap
// and nothing is borderline. Toggles are the deliberate exception: they carry
// 3600 purely so nothing can expire them, and they are admitted by the SAME
// classifier the aura strips use (isToggleAuraKind), never by a second rule
// here. A long buff that is not a toggle (the hunter aspects, Pack Rally,
// Sacrilegious March) stays out: a bar counting down 1,800 seconds is exactly
// what this family is not for.

import { absorbAuraId, buffTargetAuraId, selfBuffAuraId } from '../../../sim/combat/aura_ids';
import {
  PERFECT_MOMENT_DURATION,
  PERFECT_MOMENT_ID,
  TEMPORAL_ECHO_ID,
} from '../../../sim/combat/chronomancy';
import { TEMPORAL_HOURGLASS_ID } from '../../../sim/combat/temporal_hourglass';
import { ABILITIES } from '../../../sim/data';
import type { AbilityDef, AuraKind } from '../../../sim/types';
import { isToggleAuraKind } from '../../auras_view';

/** What kind of thing an aura is, which decides its track and its row shape. */
export type AuraTrackCategory = 'hot' | 'guard' | 'absorb' | 'utility' | 'power';

/** How a row reads. A timer drains with the clock; points drain with damage
 *  (an absorb's stored value IS its remaining shield); a mode has no countdown
 *  at all because the sim's long duration is anti-expiry, not a timer. */
export type AuraTrackRowShape = 'timer' | 'points' | 'mode';

export interface AuraTrackEntry {
  /** The id a LIVE aura carries (src/sim/combat/aura_ids.ts), which is the
   *  ability id only for an ability's primary effect. */
  id: string;
  /** The ability that applies it: its cooldown decides the Defensives line. */
  abilityId: string;
  /** The authored aura kind (the effect type for a hot or an absorb), so the
   *  tests can ask the strips' classifier the same question this module did. */
  kind: string;
  /** The authored duration in seconds; a mode's is anti-expiry, not a timer. */
  duration: number;
  category: AuraTrackCategory;
  shape: AuraTrackRowShape;
  /** The ability's cooldown in seconds, 0 for none. Separates the emergency
   *  buttons from the rotational mitigation (see DEFENSIVE_COOLDOWN_SEC). */
  cooldown: number;
  /** One cast lands an identical copy on every group member in radius, so only
   *  the copy on the LOCAL player is worth a row (see BespokeEffectAura). */
  groupWide?: true;
}

/** Nothing longer than this is a maintained effect; see the header. */
export const AURA_TRACK_DURATION_CEILING_SEC = 60;

/** At or above this cooldown a protective self-buff is an EMERGENCY button
 *  rather than part of a rotation, which is the line between the Defensives
 *  track and the Self track. The data leaves a clean gap around it: the
 *  shortest defensive cooldown is 60s and the longest rotational one is 45s. */
export const DEFENSIVE_COOLDOWN_SEC = 60;

// Aura kinds that read as protection rather than healing or output. buff_armor
// and buff_dodge only qualify at a short duration, which the ceiling handles:
// the 1800s Aspects and armor buffs never reach this table.
const GUARD_KINDS: ReadonlySet<string> = new Set([
  'buff_dr',
  'buff_dr_phys',
  'shield_wall',
  'buff_armor',
  'buff_dodge',
  'buff_block',
  // Total immunity (Cold Coffin, the mage's Ice Block). Its own kind because it
  // is not a reduction at all, and it is the single loudest thing a mage can
  // have running, so a family that showed Barkskin and not this one would be
  // read as broken.
  'stasis',
  // Two more bespoke mitigation kinds the content models on their own rather
  // than as a percentage: the warrior's parry window and the paladin bulwark.
  'die_by_sword',
  'guardian_ward',
]);

// Output buffs. Deliberately NOT protection: a haste window is spent, not
// survived, and mixing the two made Icy Veins homeless in an earlier draft.
const POWER_KINDS: ReadonlySet<string> = new Set([
  'buff_ap',
  'buff_ap_pct',
  'buff_haste',
  'buff_spellhaste',
  'buff_spellpower',
  'buff_spelldmg',
  'buff_spellcrit',
  'buff_crit',
  'buff_healing_done',
  'buff_aura_mastery',
  // The bespoke output windows: the content gives several of these their own
  // kind rather than a stat bonus, and a set that held only the stat kinds
  // would quietly drop half the cooldowns a player actually presses.
  'buff_dmg_done',
  'buff_heal_done',
  'buff_avatar',
  'buff_reckless',
  'combustion',
  'sweeping_strikes',
  'overload',
  'power_echo',
  'aoe_echo',
  'heal_echo',
  'form_lich',
  'hunter_cold_focus',
  'hunter_bloodtrail',
  // The Chronomancer's offensive window: it freezes four Arcane Charges so Aether
  // Darts fires its full barrage without spending them (combat/chronomancy.ts).
  'perfect_moment',
]);

// Movement and concealment. `ice_floes` is here rather than in POWER because
// what it grants is freedom to MOVE while casting, which is the question this
// track answers, not a damage increase.
const UTILITY_KINDS: ReadonlySet<string> = new Set([
  'buff_speed',
  'stealth',
  'form_travel',
  'ice_floes',
]);

// DELIBERATELY IN NO SET, so the omission is a decision rather than an oversight:
// the NEXT-CAST family (`cast_shield`, `next_cast_free`, `next_cast_instant`,
// `next_attack_crit`, `overpower_charge`). Each changes the next thing you press
// rather than your current state, so a bar counting one down says nothing about
// what is happening to you. Enemy debuff kinds (`mortal_wound`, `melting_acid`,
// `resource_sap`, `paladin_debt_of_light`) are out for the plainer reason that
// this family is the helpful side; the enemy side is src/ui/hud/target_dots/.

/** The aura a bespoke effect type leaves. Always names the KIND. It names the
 *  ID too whenever the sim module applies a FIXED one whichever ability cast the
 *  effect, which is the only way the catalog can avoid minting a key no live
 *  aura carries; `auraId: null` is for the effects that genuinely take the
 *  ordinary rule (the effect's own `auraId`, else the ability id). */
interface BespokeEffectAura {
  auraId: string | null;
  kind: AuraKind;
  /** Only for an effect whose content record authors no duration of its own: the
   *  sim module holds it as a constant, so the row IMPORTS that constant rather
   *  than copying its number and letting the two drift. */
  duration?: number;
  /** One cast, one identical copy on every group member in radius. Their rows
   *  carry no information the caster's own row does not, so the track shows the
   *  caster's alone; see the Offensive Cooldowns descriptor. */
  groupWide?: true;
}

// Effect types whose helpful aura NO rule below can see, because the content
// models them with a bespoke effect type that spells out no `kind` for the kind
// sets to read. Each names the id and the kind the aura actually LANDS under, so
// the ordinary rules then classify it like any other spell rather than needing a
// second derivation of their own.
//
// Every miss this table fixes was Chronomancy, the mage healer, and all of them
// were invisible in the same way: the spell simply appeared in no track and nothing
// failed, which is the exact failure mode a DERIVED catalog exists to prevent
// and the reason a new bespoke effect type belongs here rather than in FORCED.
//  - Temporal Echo marks an ally and converts a fraction of the mage's Arcane
//    damage into healing on them (combat/chronomancy.ts) rather than ticking a
//    stored total, so it is authored as its own effect type and never matched
//    `type === 'hot'` the way Wildbloom and Renew do.
//  - Hourglass of Suspension grants a short stasis to the caster or a group ally.
//    `stasis` is already a GUARD_KIND (it is what puts Cold Coffin in a track),
//    but the effect record never spells it out, so the kind sets never saw it.
//  - Temporal Acceleration is the Chronomancer's group haste burst, and the same
//    `aoeAllyHaste` effect carries the shaman and rogue versions, so naming the
//    type once covers all three (the hunter's 300s aura stays out on the ceiling,
//    as it should). It is the one row here that takes the ordinary id rule, and
//    genuinely so: applyGroupHaste writes the aura under the CASTING ability's id
//    (combat/haste_burst.ts), unlike the two Chronomancy modules beside it. It is
//    also `groupWide`, for the reason that field names. Its `_spell` companion is
//    a second aura of the same name and duration, deliberately left unnamed: it
//    would be a duplicate row per unit. That is the one asymmetry with the
//    kind-suffixed companions that DO get rows (Aether Surge's haste half): those
//    differ from their primary in kind AND duration, so a reader learns something
//    from the second row.
//  - Perfect Moment is the Chronomancer's offensive window, and the only one here
//    whose content record authors NO duration, so its row carries the sim's own
//    constant. Its `arcane_charge` companion stays out for the reason the
//    next-cast family does: a resource counter is not a window running down.
//
// TEMPORAL ECHO'S TWO CASTS SHARE ONE ROW. The individual mark and Temporal
// Cascade's group mark both apply one `temporal_echo` aura, differing only in the
// conversion rate they store, so both effect types name that id and the catalog's
// existing dedupe keeps a single row. Naming the id also stops Temporal Cascade
// minting a `temporal_cascade` row, which would be a key no live aura can match.
const BESPOKE_EFFECT_AURAS: ReadonlyMap<string, BespokeEffectAura> = new Map<
  string,
  BespokeEffectAura
>([
  ['temporalEcho', { auraId: TEMPORAL_ECHO_ID, kind: 'temporal_echo' }],
  ['massTemporalEcho', { auraId: TEMPORAL_ECHO_ID, kind: 'temporal_echo' }],
  ['temporalHourglass', { auraId: TEMPORAL_HOURGLASS_ID, kind: 'stasis' }],
  ['aoeAllyHaste', { auraId: null, kind: 'buff_haste', groupWide: true }],
  [
    'perfectMoment',
    { auraId: PERFECT_MOMENT_ID, kind: 'perfect_moment', duration: PERFECT_MOMENT_DURATION },
  ],
]);

// Aura kinds that read as a maintained HEAL on the unit carrying them. The plain
// `hot` effect spells out no kind and is matched by TYPE below; this set is for
// the healing effects the content gives a kind of their own, which is why it is
// a set rather than a second literal waiting to be widened again.
const HOT_KINDS: ReadonlySet<string> = new Set(['temporal_echo']);

// Effect shapes that leave an absorb, across the several spellings the content
// uses (a plain `absorb` effect, a `shield`, the percentage-of-max variants, and
// the group version).
const ABSORB_TYPES: ReadonlySet<string> = new Set([
  'absorb',
  'shield',
  'selfAbsorbPctMax',
  'aoeAllyAbsorb',
]);

/**
 * Aura ids this family must NOT show, for a reason the duration and kind rules
 * cannot see. Kept explicit and short: a silent exclusion is how a tracker loses
 * a spell nobody notices is missing.
 */
const EXCLUDED_IDS: ReadonlySet<string> = new Set([
  // Permanent until death or replacement (`permanent: true`), so there is no
  // timer to draw and no refresh to schedule.
  'devotion_ward',
  // An attack that happens to grant dodge on a 20 second rotation. Tracking it
  // would put a damage button in a protection track.
  'ghostly_strike',
  // A damage spell that grants 3 seconds of speed as a side effect. Utility is
  // the things you PRESS to move; a rotational nudge is not one of them.
  'scorch',
]);

/**
 * Abilities whose helpful aura the shape rules cannot see, because the content
 * models them with a bespoke effect type rather than a kind. Each names why.
 * The aura id is the ability id for every one of these.
 */
const FORCED: ReadonlyMap<string, AuraTrackCategory> = new Map([
  // A 20 second vanish on a 120 second cooldown, modelled as its own effect
  // type. It is a real timer, not a toggle: auras_view lists it in TIMED_IDS
  // for exactly the same reason.
  ['greater_invisibility', 'utility'],
]);

/** The loose view of an authored effect this module reads. */
type EffectRecord = {
  type?: unknown;
  kind?: unknown;
  duration?: unknown;
  auraId?: unknown;
};

function categoryOf(type: string, kind: string): AuraTrackCategory | null {
  if (type === 'hot' || HOT_KINDS.has(kind)) return 'hot';
  if (ABSORB_TYPES.has(type)) return 'absorb';
  if (GUARD_KINDS.has(kind)) return 'guard';
  if (UTILITY_KINDS.has(kind)) return 'utility';
  if (POWER_KINDS.has(kind)) return 'power';
  return null;
}

/**
 * The id the sim will apply this effect's aura under. The three shapes with a
 * suffix rule go through the dispatcher's own helpers; every other shape keeps
 * the ability id unless the effect names its own.
 */
function auraIdOf(def: AbilityDef, eff: EffectRecord, type: string, buffTargetIndex: number) {
  const idEff = { kind: String(eff.kind ?? ''), auraId: eff.auraId as string | undefined };
  if (type === 'selfBuff') return selfBuffAuraId(def, idEff);
  if (type === 'absorb') return absorbAuraId(def, idEff);
  if (type === 'buffTarget') return buffTargetAuraId(def, idEff, buffTargetIndex);
  const bespoke = BESPOKE_EFFECT_AURAS.get(type);
  if (bespoke !== undefined && bespoke.auraId !== null) return bespoke.auraId;
  return idEff.auraId ?? def.id;
}

/** The effect lists one ability can resolve a cast from: its base effects and
 *  each rank's. buffTarget positions count within ONE list, as the dispatcher
 *  counts them within one cast. */
function effectLists(def: AbilityDef): ReadonlyArray<readonly EffectRecord[]> {
  const ranked = (def as { ranks?: Array<{ effects?: unknown[] }> }).ranks ?? [];
  return [
    (def.effects ?? []) as unknown as readonly EffectRecord[],
    ...ranked.map((r) => (r.effects ?? []) as readonly EffectRecord[]),
  ];
}

function buildCatalog(): ReadonlyMap<string, AuraTrackEntry> {
  const out = new Map<string, AuraTrackEntry>();
  for (const [abilityId, def] of Object.entries(ABILITIES as Record<string, AbilityDef>)) {
    const cooldown = Number((def as { cooldown?: number }).cooldown ?? 0);
    const forced = FORCED.get(abilityId);
    if (forced) {
      const first = effectLists(def)[0][0];
      out.set(abilityId, {
        id: abilityId,
        abilityId,
        kind: String(first?.type ?? ''),
        duration: Number(first?.duration ?? 0),
        category: forced,
        shape: 'timer',
        cooldown,
      });
      continue;
    }
    for (const effects of effectLists(def)) {
      let buffTargetIndex = 0;
      for (const eff of effects) {
        const type = String(eff.type ?? '');
        // The effect's own kind, else the one its bespoke type is known to land,
        // so every rule below reads the kind the LIVE aura will carry.
        const kind = String(eff.kind ?? '') || (BESPOKE_EFFECT_AURAS.get(type)?.kind ?? '');
        const auraId = auraIdOf(def, eff, type, buffTargetIndex);
        if (type === 'buffTarget') buffTargetIndex++;
        if (EXCLUDED_IDS.has(auraId) || out.has(auraId)) continue;
        const category = categoryOf(type, kind);
        if (!category) continue;
        const duration = Number(eff.duration ?? BESPOKE_EFFECT_AURAS.get(type)?.duration ?? 0);
        if (duration <= 0) continue;
        // ONE toggle classifier, shared with the aura strips: the shape a row
        // takes and the pass it gets through the ceiling come from the same
        // answer, so a catalog mode is always drawn as a mode and never as a
        // timer the strips would suppress.
        const auraKind = kind || category;
        const mode = isToggleAuraKind(auraId, auraKind as AuraKind);
        if (!mode && duration > AURA_TRACK_DURATION_CEILING_SEC) continue;
        out.set(auraId, {
          id: auraId,
          abilityId,
          kind: auraKind,
          duration,
          category,
          shape: mode ? 'mode' : category === 'absorb' ? 'points' : 'timer',
          cooldown,
          ...(BESPOKE_EFFECT_AURAS.get(type)?.groupWide === true ? { groupWide: true } : {}),
        });
      }
    }
  }
  return out;
}

/** Every trackable aura, keyed by the id a live aura carries. Built once at
 *  module load. */
export const AURA_TRACK_CATALOG: ReadonlyMap<string, AuraTrackEntry> = buildCatalog();

/** The catalog entry for an aura id, or undefined when nothing tracks it. */
export function auraTrackEntry(auraId: string): AuraTrackEntry | undefined {
  return AURA_TRACK_CATALOG.get(auraId);
}
