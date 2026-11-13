// Tooltip-vs-effects consistency guard.
//
// Every ability description is prose over LIVE effect data: the placeholders
// ($d damage, $o over-time total, $b buff value, $t duration) resolve from the
// rank-resolved effects at render time (src/ui/hud.ts + src/ui/ability_damage.ts).
// This suite is the drift net behind the 2026-07 tooltip audit (PRD: tooltips
// must match actual effects):
//   1. every placeholder used in a description is RESOLVABLE for that ability
//      at every rank (an unresolvable one renders an empty string, the old
//      Earthquake/Consecration/Sunder Armor bug);
//   2. only the four supported placeholders appear;
//   3. every bare number hardcoded in a description matches the resolved
//      effect/def data at EVERY rank, so a rank-2+ tooltip can never contradict
//      what the cast actually does (the old "absorbing 48 damage" / "attack
//      power by 20" class of bug). A number that drifts with rank must use a
//      placeholder instead.
//   4. the same holds for EVERY spec of the class and for every single
//      talent-row choice, including the spec's own note: a number a spec or
//      talent changes must be a placeholder or a spec-correct note, never a
//      stale literal (the Hard Bargain "85 mana" under Blood Credit class).
import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt, type KnownAbility } from '../src/sim/content/classes';
import { ROW_TREES } from '../src/sim/content/talent_rows';
import {
  classSpecs,
  computeTalentModifiers,
  type TalentAllocation,
} from '../src/sim/content/talents';
import { ABILITIES, CLASSES } from '../src/sim/data';
import { MAX_LEVEL, type PlayerClass } from '../src/sim/types';
import {
  abilityBuffValue,
  abilityDurationValue,
  abilityOverTimeEffect,
  abilityPrimaryEffect,
  abilitySecondaryEffect,
  abilityTemporalHourglassValues,
} from '../src/ui/ability_damage';

// Numbers in prose this guard cannot derive from data, each with its source of
// truth. Keep this list SHORT and justified; prefer a placeholder in the
// description over a new entry here.
const NUMBER_ALLOWLIST: Record<string, number[]> = {
  // Courser's Guise daze lasts COURSER_DAZE_DURATION (combat/hunter_shared.ts),
  // a fixed constant applied by the damage hook, not an ability effect field.
  aspect_of_the_cheetah: [2],
  // Grace Devotion's mana cadence is stamped by effect_dispatch from its effect kind.
  grace_devotion: [5],
  // The Soul Stone heal fraction is SOUL_STONE_HEAL_PCT_MAX (src/sim/soulwell.ts),
  // an engine constant, not an effects-array value.
  soulwell: [25],
  // Pact Deepened's magic reduction lives in the talent stat resolver.
  demon_skin: [5],
  // Flash of Light's Devotion comes from the Paladin generation table, not its heal effect.
  flash_of_light: [1],
  // Lay on Hands Devotion comes from the Paladin generation table, not its heal effect.
  lay_on_hands: [1],
  // Hammer of Grace generates Devotion through the class table; Solar Reprisal's
  // full-damage self-heal is applied by the dedicated Paladin proc module.
  hammer_of_grace: [1, 100],
  // "generating 9 rage and stunning it for 1 sec": both are constants in the
  // charge arm of effect_dispatch.ts, not effect fields.
  charge: [9, 1],
  // Bruin Rush also cites its Pin rider (combat/druid_engines.ts: the 3 sec
  // window, the 50% slow, the 4 sec Pin), engine constants like the 9 and 1.
  bear_charge: [9, 1, 3, 50, 4],
  // Slinkstrike cites the Old Blood cap it banks toward. That 3 is
  // OLD_BLOOD_STAGES (combat/druid_engines.ts), an engine constant the bank
  // site enforces, not a field on the stun effect that could drift by rank.
  pounce: [3],
  // "30% more threat": the stance threat multiplier inside threatModifier.
  // Bear form's "armor +110%" and "maximum health +30%" are the
  // recalcPlayerStats multipliers (2.1 and 1.3, the v0.38 tank-parity pass)
  // in entity.ts, not the form effect's value.
  defensive_stance: [30],
  // Battle Stance's rage multiplier is applied by resourceGainMultiplier.
  battle_stance: [10],
  // Valor Roar's Protection-only damage reduction is applied when the party
  // maximum-health aura is created, rather than stored on its shared effect.
  rallying_cry: [5],
  // Bruin Form attack power is 15 + round(Agility x 1.5) (entity.ts bearForm).
  bear_form: [30, 110, 15, 1.5],
  // "compelled to attack you for 3 sec": the taunt compel window in threat.ts.
  taunt: [3],
  holy_taunt: [3],
  growl: [3],
  // Baleful Roar cites the same compel window plus its own aoeTaunt radius.
  challenging_roar: [3, 10],
  // "attack power +8 plus 2 per level": the cat-form AP constants in
  // recalcPlayerStats (entity.ts), not effect fields. "you move 15% faster":
  // CAT_FORM_MOVE_MULT (types.ts), read by moveSpeedMult; the form_cat effect
  // value is the threat multiplier.
  cat_form: [8, 2, 15],
  // "for 30 sec": the sunder aura duration hardcoded in effect_dispatch.ts.
  faerie_fire: [30],
  sunder_armor: [30],
  // "Conjures 2 ...": the stack size hardcoded in casting_lifecycle.ts.
  conjure_water: [2],
  // Worked per-combo examples (owner feedback: every finisher must spell out
  // its combo scaling): "5 combo points: N sec" is derived from base+perCombo,
  // not a raw effect field.
  kidney_shot: [5, 6],
  // Takedown (id hamstring_bite) states its resolved max the way Low Blow does.
  hamstring_bite: [5, 6],
  // Lunge's 60% weapon strike lands on arrival through combat/druid_lunge.ts
  // (LUNGE_WEAPON_MULT), so it is not an effect field on the def.
  lunge: [60],
  slice_and_dice: [5, 32],
  rupture: [2, 6, 5, 16],
  expose_armor: [2, 5, 30],
  rip: [1, 3, 5],
  // Druid spec-engine interaction lines: the cited numbers are engine
  // constants in combat/druid_engines.ts (the Moonseed extension seconds on
  // the Lunar Tempest line, the Verdance stage cap on the Sporemending line),
  // not per-rank effect fields.
  moonfire: [6],
  rejuvenation: [1, 5],
  // Rogue spec-engine interaction lines: the cited numbers are engine
  // constants in combat/rogue_engines.ts (ritual stages, stage refund, the
  // Redline window seconds and its 4+ combo opener, the shadow veil seconds,
  // the Venom Dart wound extension), not per-rank effect fields.
  eviscerate: [4, 8, 20, 25],
  backstab: [6, 15, 150],
  garrote: [6],
  ambush: [3, 6, 250],
  venom_dart: [6, 15],
  conjure_food: [2],
  // Patch Up's pet-pool heal share and revive fraction live in
  // combat/hunter_patch_up.ts (shares of the pet's own health, not effect fields).
  revive_pet: [10, 8, 50],
  // Fieldcraft's Focus, Momentum, and re-entry rules live in hunter_fieldcraft.ts.
  raptor_strike: [1, 3, 8, 10, 15],
  // The landing sprint (50% for 3 sec) lives in combat/hunter_tick.ts.
  // The "arm Re-entry for 12 sec" window is stamped by trailbreak().
  trailbreak: [12, 15, 18, 24, 50, 3],
  // The Priest spec relationship rules are post-damage hooks rather than ability effects.
  // 70 = Twin Covenant's Doctrine conversion (combat/priest/doctrine.ts).
  smite: [15, 30, 70],
  // 10 = VESPERS_DOT_DAMAGE_MULT (1.1), applied by resolveVespersAbility at
  // cast time, not by the ability effect table.
  shadow_word_pain: [1, 10],
  mind_blast: [1, 3, 30],
  // Thundercall and Stonebound values live in their spec runtime modules.
  lightning_bolt: [1, 5],
  rockbiter_weapon: [3, 10, 15, 20, 40],
  earth_shock: [3, 5, 25, 125],
  // Spiritmend deposits are calculated after the direct heal resolves.
  healing_wave: [12, 30, 50],
  // Unleash Weapon dispatches to four spec enchant implementations. Their
  // values live in shaman_unleash_weapon.ts and shaman_spiritmend.ts rather
  // than one shared ability effect array.
  unleash_weapon: [54, 64, 30, 2, 20, 6, 75, 3, 4, 125, 8, 50],
  // Harrow's deterministic break budget is WARLOCK_FEAR_DAMAGE_BUDGET_PCT
  // (src/sim/combat/warlock_fear.ts), applied when the aura is created.
  fear: [8],
  // The shared Temporal Exhaustion gate is owned by combat/haste_burst.ts.
  bloodlust: [10],
  // Divine Ascension's resource price, charge count and lifetime are owned by
  // the dedicated paladin devotion state machine, not an AbilityEffect.
  // 2 = EXTENDED_DAWN_ASCENSION_CHARGE_BONUS (paladin_devotion.ts).
  divine_ascension: [20, 5, 45, 2],
  // A hit for FEAR_BREAK_CHANCE_SCALE (0.1) of max health always breaks the fear
  // (combat/effect_dispatch.ts).
  intimidating_shout: [10],
  // Bewitch heals its target 10% of max health per second (combat/auras.ts).
  polymorph: [10],
  // Ruination's Wrack: gainRuin(1) up to RUIN_MAX 5 (combat/destruction.ts).
  shadow_bolt: [1, 5],
  // DRAIN_TICK_GAIN Condemnation per Evil Eye tick (combat/affliction.ts).
  drain_life: [2, 70],
  // Gripping Roots names its second rank's Nature DoT total (the rank 2 'dot'
  // effect in classes.ts); rank 1 has no DoT, so no placeholder can carry it.
  entangling_roots: [32],
  // Spec- and talent-aware audit (each number checked against the live code;
  // engine constants, handler literals and derived values the data cannot show).
  // src/sim/combat/druid_engines.ts:MOONTIDE_STAGES
  wrath: [3],
  // src/sim/combat/druid_engines.ts:addStage (MOONTIDE_BUILDER_IDS includes moonseed)
  moonseed: [1],
  // src/sim/combat/druid_engines.ts:addStage (MOONTIDE_BUILDER_IDS includes starfire); src/sim/content/classes.ts:sunlance dot duration 9; src/sim/content/classes.ts:sunlance gainResource amount 35
  starfire: [1, 9, 35],
  // src/sim/combat/druid_spore_burst.ts (MOONTIDE_STAGES check) + src/sim/combat/druid_engines; src/sim/combat/druid_spore_burst.ts:SPORE_BURST_FULL_BANK_POWER
  spore_burst: [3, 25],
  // src/sim/combat/druid_natures_boon.ts:NATURES_BOON_POWER; src/sim/combat/druid_natures_boon.ts:NATURES_BOON_PPM; src/sim/combat/druid_natures_boon.ts:NATURES_BOON_CHANCE; src/sim/combat/druid_natures_b
  natures_boon: [1, 4, 15, 25, 50],
  // src/sim/combat/spell_combat.ts:spellDamageMultFromAuras (form_moonkin bonus += 0.2); src/sim/entity.ts:recalcPlayerStats (moonkinForm armor * 1.5)
  moonkin_form: [20, 50],
  // src/sim/combat/druid_engines.ts:druidEngineOnLandedStrike (OLD_BLOOD_STRIKE_IDS includes m; src/sim/content/classes.ts:marrowbreak druidMarrowbreakGuard healPctMaxHp 0.18
  maul: [1, 18],
  // src/sim/combat/druid_engines.ts:OLD_BLOOD_STAGES
  claw: [3],
  // src/sim/combat/druid_engines.ts:OLD_BLOOD_STAGES
  scratch: [3],
  // src/sim/combat/druid_engines.ts:druidEngineOnLandedStrike (OLD_BLOOD_STRIKE_IDS includes f
  ferocious_bite: [1],
  // src/sim/combat/druid_engines.ts:druidEngineOnLandedStrike; src/sim/combat/druid_engines.ts:OLD_BLOOD_STAGES
  swipe: [1, 3],
  // src/sim/combat/effect_dispatch.ts:feralCharge case (buff_energyregen value 1) + src/sim/co; src/sim/combat/effect_dispatch.ts:feralCharge case (p.resource + 50)
  feral_charge: [50, 100],
  // src/sim/combat/druid_engines.ts:VERDANCE_STAGES; src/sim/combat/druid_engines.ts:VERDANCE_WILDMEND_CAST_TIMES; src/sim/combat/druid_engines.ts:VERDANCE_WILDMEND_CAST_TIMES (index 1)
  healing_touch: [1.5, 1.9, 2, 2.2, 3],
  // src/sim/combat/druid_engines.ts:druidEngineOnHotPlanted (VERDANCE_SOWING_IDS)
  regrowth: [1],
  // src/sim/combat/resurrection_reach.ts:RESURRECTION_RANGE via resurrectionCastRange(range 0)
  grove_awakening: [40],
  // src/sim/combat/druid_sporemender.ts:SPOREMENDER_HEALING_DONE_PCT / SPOREMENDER_MOVE_SPEED_; src/sim/combat/druid_sporemender.ts:SPOREMENDER_ARMOR_MULT
  sporemender_form: [20, 40],
  // src/sim/combat/druid_engines.ts:druidEngineOnCast (Wildmend) + druidEngineOnHotPlanted (Sp; src/sim/content/classes.ts:overbloom druidOverbloom harvestPct 0.6
  swiftmend: [1, 60],
  // src/sim/combat/hunter_packlord.ts:runPackCommand (setFerocity current+1, cap 3); src/sim/combat/hunter_shared.ts:PACK_FEROCITY_DAMAGE_PER_STACK (0.1, hunterFerocityDamageM
  pack_command: [1, 10],
  // src/sim/combat/hunter_shared.ts:PACK_FEROCITY_DAMAGE_PER_STACK via src/sim/combat/hunter_p; src/sim/combat/hunter_packlord.ts:STAMPEDE_RESET_CHANCE (0.2, tryResetStampede); src/sim/combat/hunter_packl
  stampede: [5, 10, 20],
  // src/sim/combat/hunter_packlord.ts:applyHowlingRage (setFerocity(ctx, hunter, 3, ...)); src/sim/combat/hunter_packlord.ts:applyHowlingRage (duration + 8, effect howlingRage durat; src/sim/combat/hunter
  bestial_wrath: [3, 8, 20, 50],
  // src/sim/combat/hunter_coldsight_read.ts:COLDSIGHT_READ_FELL_SHOT_MULT (1.75)
  arcane_shot: [75],
  // src/sim/combat/hunter_coldsight_read.ts:COLDSIGHT_READ_LONG_DRAW_MULT (1.5)
  aimed_shot: [50],
  // src/sim/combat/hunter_coldsight_read.ts:COLDSIGHT_READ_DURATION_SEC (10); src/sim/combat/hunter_coldsight_read.ts:COLDSIGHT_READ_LONG_DRAW_MULT (1.5); src/sim/combat/hunter_coldsight_read.ts:COLDSIGHT
  rapid_fire: [10, 50, 75],
  // src/sim/combat/hunter_coldsight.ts:resolveColdsightAbilityForSpec (measured_shot gainResou; src/sim/combat/hunter_coldsight.ts:resolveColdsightAbilityForSpec (aimed_shot cost * 0.75,
  cold_focus: [25, 30],
  // src/sim/content/classes.ts:mongoose_bite effects weaponMult 0.45 (both ranks); src/sim/combat/hunter_fieldcraft.ts:onFieldcraftWeaponStrike (dealDamage Math.round(wound.; src/sim/combat/hunter_fieldcr
  mongoose_bite: [1, 12, 45],
  // src/sim/combat/hunter_fieldcraft.ts:onFieldcraftWeaponStrike addMomentum(ctx, hunter, 1) a; src/sim/combat/hunting_momentum_speed.ts:HUNTING_MOMENTUM_MAX_STACKS (3); src/sim/combat/hunting_momentum_sp
  hunting_momentum: [1, 3, 15, 60],
  // src/sim/combat/hunter_fieldcraft.ts:trailbreak (FIELDCRAFT_REENTRY_ID aura remaining/durat; src/sim/combat/hunter_fieldcraft.ts:onFieldcraftWeaponStrike (dealt * 0.15 * stacks) and f; src/sim/combat/h
  fieldcraft_reentry: [3, 12, 15, 18, 24],
  // src/sim/combat/hunter_fieldcraft.ts:runShrapnelCharge addMomentum(ctx, hunter, 1)
  shrapnel_charge: [1],
  // src/sim/combat/hunter_fieldcraft.ts:finishBloodhook (Math.round(woundTotal * 0.6) on nearb; src/sim/combat/hunter_fieldcraft.ts:finishBloodhook (.slice(0, 2)) and BLOODTRAIL_SHRAPNEL; src/sim/combat/h
  bloodtrail_assault: [2, 5, 18, 25, 50, 60, 100],
  // src/sim/combat/hunter_fieldcraft.ts:applyPrimaryWound (ticks = round(duration / interval)
  bloodhook: [4],
  // src/sim/combat/ability_resolution.ts (cost = Math.round(cost * 0.9) when arms knows measur
  measured_fury: [10],
  // src/sim/combat/damage.ts:seasonedCrit (1.1 on critical auto-attack rage, arms)
  seasoned_soldier: [10],
  // src/sim/combat/auto_attack.ts:SUDDEN_DEATH_CHANCE (0.1) and SUDDEN_DEATH_DURATION (10)
  sudden_death: [10],
  // src/sim/combat/area_echo.ts:AOE_ECHO_RADIUS (8) used by sweepStrikeDamage/replayDamage
  sweeping_strikes: [8],
  // src/sim/content/classes.ts:mortal_strike dot (auraId deep_wounds) duration 6
  deep_wounds: [6],
  // src/sim/combat/effect_dispatch.ts case 'dot' (comboTotal / (duration / interval))
  mortal_strike: [2],
  // src/sim/combat/area_echo.ts:AOE_ECHO_MULT (0.4); src/sim/combat/area_echo.ts:AOE_ECHO_MAX_TARGETS (4)
  whirlwind: [4, 40],
  // src/sim/types.ts:BERSERKER_CRIT_CHANCE (0.03) and BERSERKER_CRIT_DAMAGE (0.03)
  berserker_stance: [3],
  // src/sim/combat/effect_dispatch.ts weaponStrike case (raging_gale while enraged: weaponMult
  diabolical_twinstrike: [15],
  // src/sim/content/classes.ts:bloodthirst enrageChance chance 0.3; src/sim/content/classes.ts:bloodthirst and red_harvest enrageChance duration 4; src/sim/types.ts:ENRAGE_DMG_DONE (0.07), applied in src/
  enrage_passive: [4, 7, 10, 25, 30],
  // src/sim/types.ts:REVENGE_FREE_DURATION (10) applied in src/sim/sim.ts tryRevengeFree
  revenge: [10],
  // src/sim/threat.ts:TAUNT_FORCE_SECONDS (3) via src/sim/sim.ts applyTaunt
  defiant_bellow: [3],
  // src/sim/combat/chronomancy.ts:AETHER_DARTS_BONUS_PER_CHARGE; src/sim/combat/chronomancy.ts:AETHER_SURGE_MAX_CHARGES
  arcane_missiles: [4, 9],
  // src/sim/content/chronomancy_tuning.ts:TEMPORAL_AEGIS_CAP_MAX_HP_FRACTION
  temporal_echo: [20],
  // src/sim/combat/chronomancy.ts:AETHER_SURGE_MAX_CHARGES; src/sim/combat/chronomancy.ts:AETHER_SURGE_CHARGE_WINDOW; src/sim/combat/chronomancy.ts:AETHER_SURGE_FREE_PROC_CHANCE; src/sim/combat/chronomanc
  arcane_surge: [4, 10, 15, 25],
  // src/sim/content/classes.ts:temporal_cascade.effects[0].maxTargets; src/sim/content/chronomancy_tuning.ts:TEMPORAL_CASCADE_RELIEF_MAX_BONUS; src/sim/combat/chronomancy_echo_distribution.ts:cascadeRelie
  temporal_cascade: [1, 3, 4, 6, 13, 60],
  // src/sim/combat/resurrection_reach.ts:RESURRECTION_RANGE
  collective_reversal: [40],
  // src/sim/combat/haste_burst.ts:SATED_DURATION
  temporal_acceleration: [10],
  // src/sim/combat/chronomancy.ts:applyPerfectMoment (AETHER_SURGE_MAX_CHARGES); src/sim/content/chronomancy_tuning.ts:PERFECT_MOMENT_DARTS_DAMAGE_MULT
  perfect_moment: [4, 20],
  // Ignition states the Fire mastery rule: ignitionPct 0.3 (talents_classic.ts)
  // scaled by min(1, level / 20) in computeTalentModifiers, so 1.5% per level, 30% at 20.
  ignition: [1.5, 6, 20, 30],
  // src/sim/combat/fire_mage.ts:HOT_STREAK_DURATION; src/sim/combat/fire_mage.ts:HEATING_UP_WINDOW
  hot_streak: [10, 12],
  // src/sim/combat/fire_mage.ts:IGNITE_DURATION
  meteor: [6],
  // src/sim/combat/fire_mage.ts:COMBUSTION_CDR_PER_CRIT
  combustion: [1],
  // src/sim/combat/frost_mage.ts:FINGERS_OF_FROST_CHANCE / FINGERS_OF_FROST_DURATION; src/sim/combat/frost_mage.ts:FINGERS_OF_FROST_MAX_STACKS
  fingers_of_frost: [2, 15],
  // src/sim/combat/frost_mage.ts:BRAIN_FREEZE_CHANCE; src/sim/combat/frost_mage.ts:BRAIN_FREEZE_DURATION
  brain_freeze: [15, 20],
  // src/sim/combat/frost_mage.ts:SHATTER_CRIT_BONUS
  shatter: [50],
  // src/sim/combat/frost_mage.ts:WINTERS_CHILL_DURATION; src/sim/combat/frost_mage.ts:WINTERS_CHILL_CHARGES
  flurry: [2, 5],
  // src/sim/combat/frozen_orb.ts:FROZEN_ORB_SLOW_MULT
  frozen_orb: [30],
  // src/sim/content/classes.ts:blizzard.effects[0] (duration 6.5, interval 1, delayed); src/sim/combat/frost_mage.ts:BLIZZARD_ORB_CDR_PER_ENEMY; src/sim/combat/frost_mage.ts:BLIZZARD_ORB_CDR_CAP
  blizzard: [0.5, 3, 6],
  // src/sim/combat/shaman_thundercall.ts:EARTHEN_JOLT_BONUS_PER_CHARGE; src/sim/combat/shaman_thundercall.ts:EARTHEN_JOLT_BONUS_PER_CHARGE x THUNDER_CHARGE_CAP; src/sim/combat/shaman_thundercall.ts:FAULTW
  thunder_reservoir: [20, 25, 100, 125],
  // src/sim/combat/shaman_thundercall_kit.ts:ARC_OVERLOAD_CHANCE; src/sim/combat/shaman_thundercall_kit.ts:ARC_OVERLOAD_DAMAGE_FRACTION; src/sim/combat/shaman_thundercall_kit.ts:ARC_OVERLOAD_THUNDER
  lightning_overload: [1, 20, 50],
  // src/sim/combat/shaman_thundercall_kit.ts:MAGMA_BURST_THUNDER; src/sim/combat/shaman_thundercall_kit.ts:MAGMA_BURST_CRIT_BONUS; src/sim/combat/shaman_thundercall_kit.ts:MAGMA_SURGE_CHANCE; src/sim/comb
  lava_burst: [1, 10, 20, 24],
  // src/sim/combat/shaman_thundercall_kit.ts:STORMBREAK_MANA_FRACTION
  thunderstorm: [8],
  // src/sim/content/talent_abilities_v2_a.ts:chain_lightning.effects[0].jumps
  chain_lightning: [3],
  // src/sim/combat/shaman_thundercall.ts:FAULTWAKE_BONUS_PER_CHARGE x THUNDER_CHARGE_CAP; src/sim/combat/shaman_thundercall.ts:THUNDER_CHARGE_CAP
  earthquake: [5, 100],
  // src/sim/combat/shaman_thundercall.ts:PRIMAL_MASTERY_DURATION; src/sim/combat/shaman_thundercall.ts:thundercallOnArcBoltImpact; src/sim/combat/shaman_thundercall.ts:THUNDER_CHARGE_CAP; src/sim/combat/s
  elemental_mastery: [1, 2, 5, 12, 25],
  // src/sim/combat/shaman_warspirit.ts:WARSPIRIT_CADENCE_STEPS; src/sim/combat/shaman_warspirit.ts:STORMCAST_DURATION; src/sim/combat/shaman_warspirit.ts:GALEHEART_ECHO_COUNT / combat/auto_attack.ts Ances
  warspirit_cadence: [2, 3, 12, 25, 50],
  // src/sim/combat/shaman_warspirit.ts:STORMSURGE_CHANCE; src/sim/combat/shaman_warspirit.ts:STORMSURGE_BAD_LUCK_CAP
  stormsurge: [3, 4, 25],
  // src/sim/combat/auto_attack.ts:Ancestral Strike advanceWarspiritCadence steps 2
  stormstrike: [2],
  // src/sim/combat/shaman_spiritmend.ts:LIFESPRING_DEPOSIT_BONUS
  lifespring_weapon: [20],
  // src/sim/combat/resurrection_reach.ts:RESURRECTION_RANGE
  ancestor_return: [40],
  // src/sim/combat/shaman_spiritmend.ts:CURRENT_CONSUME_MULTIPLIER
  chain_heal: [125],
  // src/sim/paladin_devotion.ts:DEVOTION_GAIN.holy.solar_invocation; src/sim/paladin_devotion.ts:resolveAscensionAbility (solar_invocation aoeHeal radius 10, 9
  solar_invocation: [1, 10],
  // src/sim/combat/paladin_beacon.ts:BEACON_HEAL_FRACTION
  beacon_of_light: [50],
  // src/sim/paladin_devotion.ts:DEVOTION_GAIN.holy.mercy_lance
  mercy_lance: [1],
  // src/sim/paladin_devotion.ts:DEVOTION_GAIN.holy.dawns_embrace; src/sim/combat/paladin_radiant_resonance.ts:RADIANT_RESONANCE_DAWN_COST_MULTIPLIER; src/sim/combat/paladin_radiant_resonance.ts:RADIANT_RE
  dawns_embrace: [1, 1.5, 35, 50],
  // src/sim/combat/paladin_radiant_resonance.ts:RADIANT_RESONANCE_DURATION; src/sim/combat/paladin_radiant_resonance.ts:RADIANT_RESONANCE_DAWN_COST_MULTIPLIER; src/sim/combat/paladin_radiant_resonance.ts:
  radiant_chorus: [1.5, 10, 20, 40, 50],
  // src/sim/paladin_devotion.ts:resolveAscensionAbility life_covenant pushes { type: 'absorb',
  life_covenant: [120],
  // src/sim/combat/paladin_consecration.ts:PROTECTION_CONSECRATION_DAMAGE_REDUCTION (wired in ; src/sim/paladin_devotion.ts:resolveAscensionAbility consecration scaleRange 1.3
  consecration: [10, 30],
  // src/sim/threat.ts:RIGHTEOUS_FURY_THREAT_MULT (applied in src/sim/combat/threat_modifiers.t
  righteous_fury: [30],
  // src/sim/paladin_devotion.ts:resolveAscensionAbility holy_shield buff_block value 0.4, dura; src/sim/paladin_devotion.ts:resolveAscensionAbility holy_shield absorb casterMaxHpPct * 1.
  holy_shield: [40, 50],
  // src/sim/combat/paladin_solar_reprisal.ts:SOLAR_REPRISAL_VOWKEEPER_CHANCE (and SOLAR_REPRIS; src/sim/combat/paladin_solar_reprisal.ts:SOLAR_REPRISAL_DURATION; src/sim/combat/paladin_solar_reprisal.ts:S
  vowkeeper_strike: [6, 8, 20, 25, 100],
  // src/sim/combat/paladin_solar_reprisal.ts:SOLAR_REPRISAL_SUNWARD_DAMAGE_MULT; src/sim/paladin_devotion.ts:resolveAscensionAbility sunward_disc chainDamage jumps: 5
  sunward_disc: [5, 20],
  // src/sim/paladin_devotion.ts:resolveAscensionAbility sacred_challenge buff_dr 0.15; src/sim/paladin_devotion.ts:resolveAscensionAbility sacred_challenge duration 4
  sacred_challenge: [4, 15],
  // src/sim/content/paladin_core_abilities.ts:bastion_sweep frontalHalfAngle Math.PI / 2; src/sim/paladin_devotion.ts:DEVOTION_GAIN.protection.bastion_sweep; src/sim/paladin_devotion.ts:resolveAscensionAb
  bastion_sweep: [1, 8, 30, 180],
  // src/sim/combat/paladin_veilbound_march.ts:updateVeilboundMarchMovement mark aura remaining; src/sim/combat/paladin_veilbound_march.ts:updateVeilboundMarchMovement mark aura value 12,; src/sim/combat/p
  veilbound_march: [1, 2, 6, 10, 12, 20, 36, 54],
  // src/sim/paladin_devotion.ts:DEVOTION_GAIN.retribution.final_edict; src/sim/combat/paladin_dawn_rhythm.ts:DAWN_RHYTHM_COOLDOWN_REDUCTION; src/sim/combat/paladin_dawns_wrath.ts:DAWNS_WRATH_PROC_CHANCE;
  final_edict: [1, 2, 15, 20],
  // src/sim/paladin_devotion.ts:DEVOTION_GAIN.retribution.dawnfall; src/sim/combat/paladin_dawn_rhythm.ts:DAWN_RHYTHM_COOLDOWN_REDUCTION; src/sim/paladin_devotion.ts:resolveAscensionAbility dawnfall scale
  dawnfall: [1, 2, 10, 50],
  // src/sim/paladin_devotion.ts:resolveAscensionAbility faithforged_guard value * 1.5
  faithforged_guard: [50],
  // src/sim/paladin_devotion.ts:DEVOTION_GAIN.retribution.hammer_of_wrath
  hammer_of_wrath: [1],
  // src/sim/combat/paladin_valkyrs_calling.ts:VALKYRS_CALLING_FLIGHT_DURATION (0.5 + 1 + 0.5)
  valkyrs_calling: [2],
  // src/sim/combat/priest/doctrine.ts:placeDoctrineLink (twin ? 0.7 : DOCTRINE_CONVERSION); src/sim/combat/priest/doctrine.ts:DOCTRINE_FALLBACK_CONVERSION; src/sim/combat/priest/doctrine_rescue.ts:SCOURIN
  scouring_mercy: [2, 15, 50, 70],
  // src/sim/combat/resurrection_reach.ts:RESURRECTION_RANGE via resurrectionCastRange(range 0)
  prayer_of_returning: [40],
  // src/sim/combat/priest/benison.ts:SERAPHIC_VIGIL_THRESHOLD
  seraphic_vigil: [35],
  // src/sim/combat/priest/vampiric_touch.ts:VAMPIRIC_TOUCH_HEAL_RATE; src/sim/combat/priest/vampiric_touch.ts:VAMPIRIC_TOUCH_CHARGES
  vampiric_touch: [2, 20],
  // src/sim/combat/priest/vespers.ts:tithefiendDuration [0,6,8,10,12,15]; src/sim/combat/priest/vespers.ts:tithefiendDuration and summonTithefiend (12 + stacks*8); src/sim/combat/priest/vespers.ts:tithefi
  summon_tithefiend: [2, 3, 5, 6, 8, 12, 15, 20, 24, 25, 35],
  // src/sim/combat/rogue_engines.ts:VENOM_RITUAL_STAGES; src/sim/content/talent_abilities_v2_a.ts:body_blow awardsCombo: 2; src/sim/combat/rogue_engines.ts:REDLINE_MAX_DEPTH
  sinister_strike: [2, 4, 6],
  // src/sim/combat/rogue_engines.ts:addStage (+1 per true Duskveil opener); src/sim/combat/rogue_engines.ts:GLOAM_STAGES; src/sim/combat/rogue_engines.ts:rogueGloamDetonation (Shadow Veil remaining: 6)
  cheap_shot: [1, 3, 6],
  // src/sim/combat/rogue_engines.ts:rogueEngineOnCast addStage for DUSK_OPENER_IDS; src/sim/combat/rogue_engines.ts:GLOAM_STAGES
  stealth: [1, 3],
  // src/sim/combat/rogue_engines.ts:GLOAM_RHYTHM_EVERY
  hemorrhage: [2],
  // src/sim/combat/affliction.ts:ENEMY_ACTION_GAIN (onAfflictionDamage, ENEMY_ACTION_GAIN_ICD ; src/sim/combat/affliction.ts:AFFLICTION_EYE_DEATH_GAIN (afflictionOnDeath); src/sim/combat/affliction.ts:AFF
  evil_eye: [2, 10, 20, 100],
  // src/sim/combat/affliction.ts:MALEDICT_GAZE_INTERVAL
  maledict_gaze: [2.5],
  // src/sim/combat/affliction.ts:FATE_THREAD_DURATION (grantFateThreads); src/sim/combat/affliction.ts:FATE_THREAD_MAX (completeNeedleOfFateCast)
  needle_of_fate: [3, 12],
  // src/sim/combat/affliction.ts:FATE_THREAD_SENTENCE_DAMAGE_PER_STACK = 0.06 (resolveSentence; src/sim/combat/affliction.ts:resolveSentence (doom >= 50 heals dealt * 0.2); src/sim/combat/affliction.ts:re
  sentence: [6, 8, 16, 35, 50, 80, 100],
  // src/sim/combat/affliction.ts:applyCursedAccomplice (self link value 2) and ACCOMPLICE_INTE; src/sim/combat/affliction.ts:applyCursedAccomplice (ally link value 3)
  cursed_accomplice: [2, 3],
  // src/sim/combat/affliction.ts:onAfflictionDamage (gain = Math.min(3, maxDoom - generated)); src/sim/combat/affliction.ts:mitigateVicariousSuffering (share = round(amount * 0.2))
  vicarious_suffering: [3, 20],
  // src/sim/combat/affliction.ts:POSSESSED_NEEDLE_CAST_TIME = 1 (afflictionAdjustedCastTime); src/sim/combat/affliction.ts:POSSESSED_NEEDLE_DOOM_BONUS = 2 (resolveNeedleOfFate); src/sim/combat/affliction.
  possess_evil_eye: [0.75, 1, 2, 17, 20, 25, 30, 60],
  // src/sim/combat/affliction.ts:applyHourOfJudgment grantFateThreads(ctx, warlock, FATE_THREA
  hour_of_judgment: [3],
  // src/sim/combat/affliction.ts:eyeGeneration (eyeMult 0.5 for affliction_eye_secondary); src/sim/combat/affliction.ts:SENTENCE_COVEN_ECHO_MULT = 0.35 (resolveSentence echo loop)
  coven: [35, 50],
  // src/sim/combat/necromancy.ts:recordOssuaryMarkDamage (storedPct = mark.value + mark.value2; src/sim/content/classes.ts:ossuary_mark effect storedDamagePct 0.2 (read in src/sim/combat
  soul_lance: [20, 70],
  // src/sim/combat/necromancy.ts:OSSUARY_DETONATE_HEAL_PCT = 0.25 (healOssuaryDetonation); src/sim/combat/necromancy.ts:grantOssuaryDeathFragment / necromancyOnDeath (addSoulFragmen
  ossuary_mark: [1, 25],
  // src/sim/content/talents_classic.ts:demonology spec Grave Dominion { global: { petDmgShareP; src/sim/combat/necromancy.ts:applyReapingRider graveguard shield_wall value 0.3; src/sim/combat/necromancy.t
  raise_graveguard: [4, 20, 30],
  // src/sim/combat/necromancy_dominion.ts:NECROMANCY_DOMINION_CAP = 2; src/sim/content/necromancy.ts:necromancy_skeletal_warrior petCleave.mult 0.45; src/sim/content/necromancy.ts:necromancy_skeletal_warr
  raise_skeletal_warrior: [2, 4, 6, 40, 45],
  // src/sim/content/necromancy.ts:necromancy_bone_mage petRanged.spellVuln.amp 0.05; src/sim/content/necromancy.ts:necromancy_bone_mage petRanged.spellVuln.duration 6 (also sr
  raise_bone_mage: [5, 6],
  // src/sim/combat/necromancy.ts:necromancyOnDeath addSoulFragments(ctx, owner, 1); src/sim/combat/necromancy.ts:FUNERAL_HARVEST_LOCKOUT = 3
  funeral_harvest: [1, 3],
  // src/sim/content/necromancy.ts:necromancy_gravewing petCleave.mult 0.65; src/sim/content/necromancy.ts:necromancy_gravewing petCleave.cooldown 5; src/sim/combat/necromancy.ts:applyReapingRider gravewin
  raise_gravewing: [5, 8, 65],
  // src/sim/combat/necromancy.ts:LICH_SOUL_LANCE_PIERCE_TARGETS = 2
  metamorphosis: [2],
  // src/sim/combat/destruction.ts:RUINOUS_BRAND_SELF_PCT = 0.25 (reserveRuinousBrandCopy); src/sim/combat/destruction.ts:RUINOUS_BRAND_COPY_PCT = 0.5 (stored as brand.value)
  ruinous_brand: [25, 50],
  // src/sim/combat/destruction.ts:PYRE_AURA_DAMAGE = round(60 * petOffenseMultiplier(warlock, ; src/sim/combat/destruction.ts:PYRE_AURA_RADIUS = 8; src/sim/combat/destruction.ts:PYRE_AURA_INTERVAL = 2 (ti
  summon_infernal: [1, 2, 8, 66],
  // src/sim/combat/destruction.ts:destructionAfterCast (conflagrate: gainRuin 1, gainDesolatio; src/sim/combat/destruction.ts:DESOLATION_DURATION = 15
  conflagrate: [1, 15],
  // the catalog splices the resolved {weaponPercent}; the sim source keeps the base literal
  body_blow: [130],
  // rank 1 maxTargets, stated beside the rank 2 rule (4 from Rank 2)
  litany_of_guilt: [2],
};

// Every resolved rank of every class ability (deduped by rank).
function resolvedRanks(cls: PlayerClass): Map<string, KnownAbility[]> {
  const byId = new Map<string, KnownAbility[]>();
  for (let level = 1; level <= MAX_LEVEL; level++) {
    for (const known of abilitiesKnownAt(cls, level)) {
      const list = byId.get(known.def.id) ?? [];
      if (!list.some((k) => k.rank === known.rank)) list.push(known);
      byId.set(known.def.id, list);
    }
  }
  return byId;
}

// All numbers a description may legitimately cite for one resolved rank: every
// numeric leaf of the resolved effects and the def, plus derived forms readers
// see (percent from a fraction or multiplier, minutes from seconds, a channel's
// tick cadence).
function trueNumbers(known: KnownAbility): Set<number> {
  const out = new Set<number>();
  const add = (v: number) => {
    if (!Number.isFinite(v)) return;
    out.add(v);
    out.add(Math.round(v * 100) / 100);
  };
  const collect = (value: unknown) => {
    if (typeof value === 'number') {
      add(value);
      if (value > 0 && value < 1) {
        add(value * 100); // fraction as percent: 0.4 -> "40%"
        add((1 - value) * 100); // slow multiplier as reduction: 0.5 -> "slowing by 50%"
      }
      if (value > 1 && value <= 3) {
        add((value - 1) * 100); // multiplier as increase: 1.9 -> "+90%"
        add(value * 100); // multiplier as weapon-damage percent: 1.5 -> "150% weapon damage"
      }
      if (value >= 60 && value % 60 === 0) add(value / 60); // seconds as minutes
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value)) collect(item);
    }
  };
  // The RESOLVED effects only: collecting from def.effects/def.ranks would let a
  // rank-1 number pass as "true" at rank 3, the exact drift this test exists to
  // catch. The rest of the def (range, cooldown, channel, combo riders, ...) is
  // rank-invariant and fair game for prose.
  collect(known.effects);
  const { effects: _effects, ranks: _ranks, specNotes: _notes, ...defStatics } = known.def;
  collect(defStatics);
  add(known.cost);
  add(known.castTime);
  add(known.cooldown);
  const ch = known.def.channel;
  if (ch && ch.ticks > 0) add(ch.duration / ch.ticks);
  if (known.charges !== undefined) add(known.charges);
  return out;
}

// Bare numbers in the prose, with every $-placeholder stripped first so the
// placeholder letters and their substitutions never count.
function proseNumbers(description: string): number[] {
  return (description.replace(/\$[a-z]/g, ' ').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

const PLACEHOLDERS = /\$([a-zA-Z])/g;
const SUPPORTED = new Set(['d', 'o', 'b', 't', 'h', 'e', 'p', 'g', 's', 'a', 'x', 'y', 'z']);

describe('ability descriptions match their resolved effects', () => {
  const classes = Object.keys(CLASSES) as PlayerClass[];

  it('uses only supported dynamic placeholders', () => {
    for (const a of Object.values(ABILITIES)) {
      for (const m of a.description.matchAll(PLACEHOLDERS)) {
        expect(SUPPORTED.has(m[1]), `${a.id}: unknown placeholder $${m[1]}`).toBe(true);
      }
      // Brace-form tokens are reserved for the translated catalog; the sim
      // source uses the $-form so the entity-i18n fallback path always works.
      expect(a.description, `${a.id}: use $-placeholders in the sim source`).not.toMatch(
        /\{[A-Za-z0-9_]+\}/,
      );
    }
  });

  it('every placeholder resolves at every rank (no empty tooltip numbers)', () => {
    for (const cls of classes) {
      for (const [id, ranks] of resolvedRanks(cls)) {
        const desc = ABILITIES[id].description;
        for (const known of ranks) {
          const at = `${cls}.${id} rank ${known.rank}`;
          if (desc.includes('$d')) {
            expect(
              abilityPrimaryEffect(known) ?? abilitySecondaryEffect(known),
              `${at}: $d has no effect to read`,
            ).toBeTruthy();
          }
          if (desc.includes('$o')) {
            expect(abilityOverTimeEffect(known), `${at}: $o has no dot/hot`).toBeTruthy();
          }
          if (desc.includes('$b')) {
            expect(abilityBuffValue(known), `${at}: $b has no buff value`).not.toBeNull();
          }
          if (desc.includes('$t')) {
            expect(abilityDurationValue(known), `${at}: $t has no timed effect`).not.toBeNull();
          }
          if (desc.includes('$h')) {
            expect(
              abilityTemporalHourglassValues(known) ??
                known.effects.find((effect) => effect.type === 'heal'),
              `${at}: $h has no healing effect`,
            ).toBeTruthy();
          }
          if (/\$(?:e|p|g|s|a)/.test(desc)) {
            expect(
              abilityTemporalHourglassValues(known),
              `${at}: Hourglass placeholders have no temporalHourglass effect`,
            ).not.toBeNull();
          }
        }
      }
    }
  });

  it('hardcoded numbers hold at every rank (drifting numbers must be placeholders)', () => {
    const failures: string[] = [];
    for (const cls of classes) {
      for (const [id, ranks] of resolvedRanks(cls)) {
        const desc = ABILITIES[id].description;
        const cited = proseNumbers(desc);
        if (!cited.length) continue;
        const allow = new Set(NUMBER_ALLOWLIST[id] ?? []);
        for (const n of cited) {
          if (allow.has(n)) continue;
          const staleRanks = ranks.filter((known) => !trueNumbers(known).has(n));
          if (staleRanks.length) {
            failures.push(
              `${cls}.${id}: "${desc}" cites ${n}, not true at rank(s) ${staleRanks
                .map((k) => k.rank)
                .join(', ')}`,
            );
          }
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
  it('hardcoded numbers hold for every spec and every talent choice', () => {
    const failures: string[] = [];
    for (const cls of classes) {
      for (const spec of [null, ...classSpecs(cls)]) {
        const allocations: { label: string; alloc: TalentAllocation }[] = [
          { label: 'spec only', alloc: { spec, rows: {} } },
        ];
        for (const row of ROW_TREES[cls]) {
          for (const opt of row.options) {
            allocations.push({ label: opt.id, alloc: { spec, rows: { [row.level]: opt.id } } });
          }
        }
        const specOnly = new Map(
          abilitiesKnownAt(cls, MAX_LEVEL, computeTalentModifiers(cls, { spec, rows: {} })).map(
            (k) => [k.def.id, trueNumbers(k)],
          ),
        );
        for (const { label, alloc } of allocations) {
          const mods = computeTalentModifiers(cls, alloc);
          for (const known of abilitiesKnownAt(cls, MAX_LEVEL, mods)) {
            const id = known.def.id;
            const note = spec ? (known.def.specNotes?.[spec] ?? '') : '';
            const allow = new Set(NUMBER_ALLOWLIST[id] ?? []);
            const truth = trueNumbers(known);
            for (const n of proseNumbers(`${known.def.description} ${note}`)) {
              if (allow.has(n) || truth.has(n)) continue;
              // A talent choice is only blamed for numbers it made stale; the
              // spec-only pass reports the rest once.
              if (label !== 'spec only' && !specOnly.get(id)?.has(n)) continue;
              failures.push(`${cls}.${id} [${spec ?? 'no spec'}, ${label}] cites ${n}`);
            }
          }
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
});
