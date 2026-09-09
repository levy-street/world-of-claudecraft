// v0.42.0 class balance: a small, pure offense-only tuning table (docs/design/class-balance-v042.md).
//
// The legacy global.meleeDmgPct/spellDmgPct bucket also reaches flat-magnitude
// buffs (buff_ap/buff_armor/buff_spellpower/thorns) in content/classes.ts's
// scaleEffect (Fiendhide on warlock's spellDmgPct is the documented example),
// so growing it would inflate an unrelated buff. This table is a SEPARATE
// additive component folded into talent_hit_mult.ts's dmgMult, reaching only
// real damage-effect magnitudes and their runtime SP/AP/weapon riders, never a
// buff, heal, absorb, or stat (talent_hit_mult.ts's legacyDmgMult is the value
// scaleEffect uses for a buff instead).
//
// Pure: no SimContext/rng/Sim import. A Vitest imports it directly.

import type { TalentModifiers } from './content/talents';
import type { AbilityDef, PlayerClass } from './types';

interface OffensiveSpecTuning {
  /** Additive bonus applied to physical-bucket damage (school 'physical', or
   *  any ability scaling as a ranged shot; see talent_hit_mult.ts). */
  physical?: number;
  /** Additive bonus applied to spell-bucket damage (every other school). */
  spell?: number;
}

// One row per v0.42.0 damage-target spec. Values are the DELTA on top of the
// spec's existing legacy global bucket, not the resulting total (see the
// design doc's "before -> candidate" table); the legacy bucket itself is left
// untouched by this change.
const OFFENSIVE_SPEC_TUNING: Partial<Record<PlayerClass, Record<string, OffensiveSpecTuning>>> = {
  druid: {
    // Wildfang: feral AP is a stats.apPct edit in spec_baselines.ts (also
    // lifts bear-form autos and threat alongside cat-form ability
    // damage); this is the paired offensive physical ability bonus.
    feral: { physical: 0.15 },
  },
  shaman: {
    // Thundercall: elemental offensive spell bonus. Arc Bolt/Earthen Jolt
    // resolve as normal AbilityDefs, so they pick this up through the shared
    // resolveTalentHitMult seam; the Earthen Jolt vent multiplier
    // (shaman_thundercall.ts) stacks on top of the already-scaled hit.
    elemental: { spell: 0.13 },
  },
  warlock: {
    // Ruination: destruction owner spell bonus. The paired pet bonus is a
    // global.petDmgPct edit in spec_baselines.ts (read directly by
    // hunterPetDamageMultiplier for every pet owner, hunter and warlock
    // alike); Pyre Aura bypasses that path entirely, so it takes the explicit
    // PYRE_AURA_DAMAGE fix in combat/destruction.ts instead.
    destruction: { spell: 0.11 },
    // Necromancy: owner spell bonus (0.10 legacy + 0.22 here = 0.32 total).
    // Essence Reap/Soul Harvest's own ability-scoped dmgPct additionally
    // moves 0.08 -> 0.096 directly in spec_baselines.ts (the exact +20%
    // arithmetic the design doc works through). The paired baseline pet
    // bonus is a global.petDmgPct edit (0.15 -> 0.42) in spec_baselines.ts.
    demonology: { spell: 0.22 },
  },
  rogue: {
    // Knifework: assassination offensive melee bonus (0.22 legacy + 0.10
    // here = 0.32 total); AP is a stats.apPct edit (0.36 -> 0.57). Physical
    // bucket only: the poison imbues (nature school) get none of this bonus,
    // so the spec's share of the total arrives through AP and the physical
    // abilities alone.
    assassination: { physical: 0.1 },
  },
  hunter: {
    // Fieldcraft: survival offensive ability bonus (0.30 legacy + 0.15 here
    // = 0.45 total); AP is a stats.apPct edit (0.15 -> 0.22).
    survival: { physical: 0.15 },
    // Coldsight numeric budget: a new offensive physical bonus, no AP change.
    marksmanship: { physical: 0.1 },
  },
  priest: {
    // Doctrine: discipline personal primary damage x1.30. Discipline carries
    // no legacy global bucket, so this alone reaches the target 1.30 total
    // (1 + 0.30) on Hymn/Smite, hostile Scouring Mercy, Mindfracture, and
    // Dirge (all ordinary AbilityDefs). Also raises Doctrine's converted
    // healing by the same 30%, since the conversion reads
    // the already-boosted damage; primaryHealingMultiplier itself still
    // leaves discipline at 1 (no separate healer-side factor). Wand output is
    // a fixed-formula ranged autoattack outside the AbilityDef seam;
    // disciplineWandOffenseMultiplier() below applies the same 1.30 there.
    discipline: { physical: 0.3, spell: 0.3 },
  },
};

// Warlock destruction pet damage bypasses the shared petDmgPct-reading
// hunterPetDamageMultiplier: tickPyreGuardian (combat/destruction.ts) deals
// its periodic nova with a raw ctx.dealDamage call. This is the one place
// that explicit destruction-only pet bonus lives, so the 60 -> 66 fix has a
// named, testable source instead of a bare literal.
const PET_OFFENSE_TUNING: Partial<Record<PlayerClass, Record<string, number>>> = {
  warlock: { destruction: 0.1 },
};

/** True when `ability` resolves against the physical global bucket, mirroring
 *  talent_hit_mult.ts's own bucket split (hunter ranged shots always take the
 *  melee/physical bucket regardless of school). */
export function isPhysicalBucketAbility(
  ability: Pick<AbilityDef, 'school' | 'scalesWith'>,
): boolean {
  return ability.school === 'physical' || ability.scalesWith === 'ranged';
}

/**
 * The v0.42.0 offense-only additive bonus for one ability, given the
 * player's precomputed TalentModifiers. Zero for every untargeted spec and
 * every no-spec character (root invariant: an offensive rebalance leaves a
 * spec-less or untuned character with a factor of exactly one extra bonus).
 */
export function offensiveAbilityBonus(
  ability: Pick<AbilityDef, 'class' | 'school' | 'scalesWith'>,
  mods: Pick<TalentModifiers, 'spec'>,
): number {
  if (!mods.spec) return 0;
  const tuning = OFFENSIVE_SPEC_TUNING[ability.class]?.[mods.spec];
  if (!tuning) return 0;
  const bonus = isPhysicalBucketAbility(ability) ? tuning.physical : tuning.spell;
  return bonus ?? 0;
}

/** The explicit destruction-only Pyre Aura pet bonus (combat/destruction.ts).
 *  Zero for every class/spec other than committed destruction. */
export function petOffenseMultiplier(cls: PlayerClass, spec: string | null): number {
  if (!spec) return 1;
  return 1 + (PET_OFFENSE_TUNING[cls]?.[spec] ?? 0);
}

/** The wand-only offense multiplier for Doctrine discipline
 *  (combat/auto_attack.ts's fixed-formula wand path, outside the AbilityDef
 *  seam). Derived from the same discipline row offensiveAbilityBonus reads,
 *  not a second hardcoded literal; narrowly gated to that one spec since no
 *  other row is meant to reach a wand hit. */
export function disciplineWandOffenseMultiplier(): number {
  return 1 + (OFFENSIVE_SPEC_TUNING.priest?.discipline?.physical ?? 0);
}

/**
 * The v0.42.0 healer primary-healing factor (Spiritmend, Sunmender,
 * Groveheart). Applied once to the complete raw primary heal or HoT amount
 * after base/Healing Power/existing modifiers, before crit/target resolution
 * or HoT/pool storage (src/sim/primary_healing.ts `scalePrimaryHealing`); a
 * factor of one preserves the original value exactly.
 */
export function primaryHealingMultiplier(cls: PlayerClass, spec: string | null): number {
  if (cls === 'shaman' && spec === 'restoration') return 1.1;
  if (cls === 'paladin' && spec === 'holy') return 1.1;
  // Together with corrected Wildbloom replants: +19.9% across the paired engine profiles.
  if (cls === 'druid' && spec === 'restoration') return 1.05;
  return 1;
}
