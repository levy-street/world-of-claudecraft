// Crucible tier-set ENGINE bonuses (Ignivar raid loot Phase B): the 2-piece
// and 4-piece payloads for the 29 five-piece sets, as TalentEffect records
// accumulated into the wearer's TalentModifiers by src/sim/set_bonus_mods.ts.
//
// Every bonus here modifies the spec's underlying engine (rotation loop,
// resource bank, signature mechanic), never raw stats: that is the maintainer
// ruling (docs/prd/ignivar-raid-loot.md, decision 7), and it is why these live
// on the TALENT seam rather than in item_sets.ts's SetBonusEffect stat
// vocabulary. The canonical design for all 58 bonuses, including the
// per-bonus implementation notes and same-change copy obligations, is
// docs/prd/ignivar-set-bonus-final.md.
//
// Two implementation shapes, often combined:
//  - GENERIC: the tier's `effect` is a plain TalentEffect (ability rows,
//    procs, global mods) that accumulateTalentEffect applies with zero
//    class-module changes.
//  - BESPOKE: the tier's real logic is a call-site bend inside the class
//    module, gated on the wearer flag the resolver registers for every met
//    tier (`setBonusFlag(setId, pieces)` in mods.selected, exactly how talent
//    options gate their call sites). The `effect` then carries only the
//    audited numbers under `tuning`, so tooltip-accuracy tests can pin the
//    authored copy against the implementation constants.
//
// ROLLOUT LEDGER: sets register here (and in item_sets.ts, which owns the
// tooltip text) one class wave at a time, text and engine TOGETHER, so a
// tooltip never promises an unimplemented bonus. The not-yet-registered set
// ids stay pinned ABSENT in tests/ignivar_loot.test.ts until their wave.
//
// Data-as-code: balance numbers live here, never inline in the engine.
// `src/sim`-pure; no rng, no clock.

import type { TalentEffect } from './talents';

export interface SetEngineBonusTier {
  pieces: number;
  effect: TalentEffect;
}

// The wearer flag registered in TalentModifiers.selected for every met tier:
// bespoke call sites gate on it exactly like a talent option id.
export function setBonusFlag(setId: string, pieces: number): string {
  return `setbonus_${setId}_${pieces}pc`;
}

// Audited constants for the bespoke warrior bends (read by the class module
// call sites AND pinned by tests, so the copy cannot drift from the code).
/** Slagbreaker 4pc: seconds refunded from Breachmaker per Redhand cast. */
export const SLAGBREAKER_4PC_BREACHMAKER_REFUND_SEC = 3;
/** Emberfury 2pc: seconds added to every Enrage trigger's duration. */
export const EMBERFURY_2PC_ENRAGE_DURATION_BONUS = 2;
/** Emberfury 4pc: Bloodletting's self-heal fraction of max health (base 0.03). */
export const EMBERFURY_4PC_BLOODLETTING_HEAL_PCT_MAX = 0.08;
/** Forgewall 2pc: absorb granted per rage spent by Iron Resolve (base 4). */
export const FORGEWALL_2PC_ABSORB_PER_RAGE = 5;
/** Forgewall 4pc: seconds refunded from Iron Resolve per Shieldcrack cast. */
export const FORGEWALL_4PC_IRON_RESOLVE_REFUND_SEC = 2;

// Audited constants for the bespoke paladin bends (read by the class-module
// call sites AND pinned by tests, so the copy cannot drift from the code).
/** Dawnforged 2pc: Beacon of Light transfer fraction (base BEACON_HEAL_FRACTION 0.5).
 *  Baked into the beacon AURA VALUE at placement, the ONE source both the
 *  heal.ts transfer arithmetic and the aura mirror read, so the two readers
 *  can never diverge. A gear swap after placement keeps the placed fraction
 *  until the beacon is re-cast (the same at-grant snapshot the Zealfire 4pc
 *  aura bake uses). */
export const DAWNFORGED_2PC_BEACON_HEAL_FRACTION = 0.55;
/** Dawnforged 4pc: the Radiant Resonance empowered Dawn's Embrace cast time
 *  (base RADIANT_RESONANCE_DAWN_CAST_TIME 1.5): instant for wearers. */
export const DAWNFORGED_4PC_DAWN_CAST_TIME = 0;
/** Oathpyre 2pc: Vowkeeper Strike's Solar Reprisal arm chance (base 0.2). */
export const OATHPYRE_2PC_VOWKEEPER_CHANCE = 0.3;
/** Oathpyre 2pc: the block-arm Solar Reprisal chance (base 0.25). */
export const OATHPYRE_2PC_BLOCK_CHANCE = 0.4;
/** Oathpyre 4pc: shield fraction of max health on Solar Reprisal consume. */
export const OATHPYRE_4PC_SHIELD_PCT_MAX = 0.06;
/** Oathpyre 4pc: shield duration in seconds. */
export const OATHPYRE_4PC_SHIELD_DURATION_SEC = 10;
/** Zealfire 2pc: the Final Edict / Dawnfall paired cooldown cut in seconds
 *  (base DAWN_RHYTHM_COOLDOWN_REDUCTION 2). */
export const ZEALFIRE_2PC_DAWN_RHYTHM_CUT_SEC = 3;
/** Zealfire 4pc: Dawn's Wrath Hammer of Wrath damage mult (base 1.2). */
export const ZEALFIRE_4PC_DAWNS_WRATH_DAMAGE_MULT = 1.4;

// Audited constants for the bespoke hunter bends (read by the class-module
// call sites AND pinned by tests, so the copy cannot drift from the code).
/** Packlord 4pc: Pack Command's Stampede reset chance (base
 *  STAMPEDE_RESET_CHANCE 0.2). The threshold moves on the SAME single roll at
 *  tryResetStampede, so no rng stream shift for wearers or non-wearers; the
 *  5-fail bad-luck cap is untouched. */
export const PACKLORD_4PC_STAMPEDE_RESET_CHANCE = 0.3;
/** Coldsight 2pc: extra Focus on Measured Shot, applied by the named module
 *  hook AFTER the Cold Focus absolute rewrite (20 to 25 outside the window,
 *  30 to 35 inside it; Harrier's 1.5x multiplies the result afterward, the
 *  disclosed 38/53). */
export const COLDSIGHT_2PC_MEASURED_SHOT_FOCUS_BONUS = 5;
/** Coldsight 4pc: seconds each Long Draw critical adds to the running Cold
 *  Focus window. */
export const COLDSIGHT_4PC_CRIT_EXTENSION_SEC = 2;
/** Coldsight 4pc: total extension cap per Cold Focus window, in seconds. */
export const COLDSIGHT_4PC_WINDOW_EXTENSION_CAP_SEC = 6;
/** Slagsnare 2pc: Focus a landed Gutting Strike grants (base 15). The
 *  Harrier and Efficient Rhythm riders apply after (preResolved false),
 *  exactly as they do for the base grant. */
export const SLAGSNARE_2PC_GUTTING_STRIKE_FOCUS = 20;
/** Slagsnare 4pc: the once-per-8-sec momentum-preserve lockout; deliberately
 *  MATCHES the Hunting Momentum window by construction. */
export const SLAGSNARE_4PC_MOMENTUM_ICD_SEC = 8;

// Audited constants for the bespoke rogue bends (read by the class-module
// call sites AND pinned by tests, so the copy cannot drift from the code).
/** Cinderfang 2pc: energy refunded per qualifying Venom Ritual builder cast
 *  (base VENOM_STAGE_REFUND 15). BOTH refund readers in
 *  combat/rogue_engines.ts (the Venom Dart grant and the Craven Thrust
 *  grant) bend together; the Wicked Slash fallback keeps its existing
 *  exclusion (the anti-self-funding guard), so a non-dagger build forced
 *  onto the fallback feels nothing, disclosed by the set doc. */
export const CINDERFANG_2PC_VENOM_STAGE_REFUND = 20;
/** Smolderstrike 4pc: seconds refunded from Mirrored Blades (blade_flurry)
 *  per Lights Out cast. */
export const SMOLDERSTRIKE_4PC_MIRRORED_BLADES_REFUND_SEC = 6;
/** Ashveil 4pc: the Veiled Edge aura VALUE baked at arm time (base
 *  VEILED_EDGE_BONUS 1). consumeVeiledEdge returns 1 + value, so 2 reads
 *  back as the promised triple. */
export const ASHVEIL_4PC_VEILED_EDGE_BONUS = 2;

// Audited constants for the bespoke priest bends (read by the class-module
// call sites AND pinned by tests, so the copy cannot drift from the code).
/** Emberscreed (Creed of Embers) 2pc: ADDITIVE bonus on the Doctrine link
 *  conversion, applied on BOTH twin branches at placeDoctrineLink (0.3 -> 0.4
 *  base, 0.7 -> 0.8 under Twin Covenant). The bonus is baked into the link
 *  aura VALUE at placement, so old links keep their placed rate for up to the
 *  30 sec duration (snapshot-at-placement, the beacon/Dawn's Wrath posture);
 *  the 0.15 no-link fallback is deliberately untouched. */
export const EMBERSCREED_2PC_DOCTRINE_CONVERSION_BONUS = 0.1;
/** Emberscreed 4pc: seconds the instant Scouring Hymn empower lasts after a
 *  fully consumed Psalm of Warding. */
export const EMBERSCREED_4PC_HYMN_WINDOW_SEC = 10;
/** Emberscreed 4pc: the internal cooldown between empower grants. */
export const EMBERSCREED_4PC_HYMN_ICD_SEC = 15;
/** Benison Dawnweave 2pc: Seraphic Vigil's resolved rescue heal (base 180
 *  x the 1.5 buffPct row; heal_echo is in neither the integral nor the
 *  scalable buff-kind sets, so the resolved value is exactly this flat 270). */
export const BENISON_2PC_VIGIL_RESCUE_HEAL = 270;
/** Benison Dawnweave 4pc: the mend on the Vigil's ally, as a fraction of the
 *  ALLY'S max health, paid over the duration below. */
export const BENISON_4PC_MEND_PCT_MAX = 0.15;
/** Benison Dawnweave 4pc: mend duration in seconds. */
export const BENISON_4PC_MEND_DURATION_SEC = 10;
/** Benison Dawnweave 4pc: seconds between mend ticks (5 ticks total). */
export const BENISON_4PC_MEND_TICK_INTERVAL_SEC = 2;
/** Vesperash 2pc: seconds cut from Call Tithefiend's cooldown (base 30). */
export const VESPERASH_2PC_TITHEFIEND_COOLDOWN_CUT_SEC = 6;
/** Vesperash 4pc: multiplier on the Tithefiend's per-hit mana return (base
 *  TITHEFIEND_MANA_RETURN_RATE 0.01 stays untouched for everyone else). */
export const VESPERASH_4PC_MANA_RETURN_MULT = 2;

// Audited constants for the bespoke shaman bends (read by the class-module
// call sites AND pinned by tests, so the copy cannot drift from the code).
/** Stormkindled 2pc: Thunder granted by Unleash Weapon on Pyrebrand (base
 *  PYREBRAND_UNLEASH_THUNDER 2). With 3 or more already banked part of the
 *  grant overcaps at the 5-charge cap (disclosed by the set doc). */
export const STORMKINDLED_2PC_UNLEASH_THUNDER = 3;
/** Stormkindled 4pc: Earthen Jolt's per-Thunder vent bonus (base
 *  EARTHEN_JOLT_BONUS_PER_CHARGE 0.25): the full 5-charge vent goes
 *  2.25x -> 2.5x, and Primal Mastery's 1.25 vent window still MULTIPLIES the
 *  result (3.125x in-window, disclosed). Faultwake stays untouched. */
export const STORMKINDLED_4PC_EARTHEN_JOLT_BONUS_PER_CHARGE = 0.3;
/** Warspirit Emberscale 2pc: cadence steps per Ancestral Strike (base 2 at
 *  the combat/auto_attack.ts call site). */
export const WARSPIRIT_EMBERSCALE_2PC_CADENCE_STEPS = 3;
/** Warspirit Emberscale 4pc: the stormstrike dmgPct row. The printed number
 *  is 30 percent DELIVERED: the accumulator is additive (talent_hit_mult.ts,
 *  1 + meleeDmgPct + dmgPct), and a committed Warspirit at the raid's level
 *  20+ carries the 0.6 spec-baseline stormstrike row PLUS the fully scaled
 *  Skyrend mastery's 0.1 meleeDmgPct, so the real baseline is 1.7 and the
 *  row is 0.3 x 1.7 = 0.51 (2.21 / 1.7 = 1.30 exactly). The set doc's
 *  bracketed 0.48 assumed a 1.6 baseline (it missed the mastery); recorded
 *  as a deviation in the wave's PR notes. */
export const WARSPIRIT_EMBERSCALE_4PC_STORMSTRIKE_DMG_PCT = 0.51;
/** Stonehearth 2pc: the extra healing on a Stormcast Mending Waters cast
 *  made while Stonebound (the same cast also bills no mana). */
export const STONEHEARTH_2PC_MENDING_HEAL_BONUS = 0.25;
/** Stonehearth 4pc: self-heal fraction of max health when a cadence
 *  completes while Stonebound (a HEAL, never an absorb). */
export const STONEHEARTH_4PC_CADENCE_HEAL_PCT_MAX = 0.03;
/** Springmender 2pc: seconds cut from Tidecall's cooldown (base 12; Tidecall
 *  holds two PARALLEL-recharging charges, so this is +50 percent Tidecall
 *  throughput, the set doc's honesty note). */
export const SPRINGMENDER_2PC_TIDECALL_COOLDOWN_CUT_SEC = 4;
/** Springmender 4pc: extra Cascading Mend hop (jumps 2 -> 3, a fourth ally). */
export const SPRINGMENDER_4PC_BONUS_JUMPS = 1;
/** Springmender 4pc: the CHAIN-path Mending Current harvest multiplier (base
 *  CURRENT_CONSUME_MULTIPLIER 1.25; Unleash Weapon's collapse keeps 1.25). */
export const SPRINGMENDER_4PC_CHAIN_HARVEST_MULT = 1.5;

// Audited constants for the bespoke mage bends (read by the class-module
// call sites AND pinned by tests, so the copy cannot drift from the code).
/** Chronoweave (Aetherweave Vestments) 2pc: the SINGLE-TARGET Temporal Echo
 *  conversion rate (base ECHO_CONVERT_SINGLE 0.4). Baked into the mark aura
 *  at placeTemporalEcho, the one write both combat (echoConvertRate) and the
 *  aura tooltip (value) read back, so the two can never diverge; a gear swap
 *  after placement keeps the placed rate until the echo is re-cast (the same
 *  at-grant snapshot the beacon and Dawn's Wrath bakes use). The area rate
 *  (0.15) and the Cascada group rates (0.13/0.06) are deliberately untouched:
 *  the copy promises single-target only. */
export const CHRONOWEAVE_2PC_ECHO_CONVERT_SINGLE = 0.5;
/** Chronoweave 4pc: seconds cut from Temporal Cascade's cooldown (base 17). */
export const CHRONOWEAVE_4PC_CASCADE_COOLDOWN_CUT_SEC = 5;
/** Pyroclast 2pc: the Scald guaranteed-crit execute threshold as a fraction
 *  of the target's max health (base SCORCH_EXECUTE_HP 0.3). Retuned 0.5 to
 *  0.35 (2026-08-30): at 0.5 the entire bottom half of a fight played at the
 *  execute ceiling (the lay-of-the-land study measured 330 vs 145 DPS at a
 *  40 percent pin), the study's dominant outlier. */
export const PYROCLAST_2PC_SCALD_EXECUTE_HP = 0.35;
/** Pyroclast 4pc: seconds a builder crit landed outside Phoenix Trance shaves
 *  off its running cooldown (base COMBUSTION_CDR_PER_CRIT 1). Retuned 2 to
 *  1.5 in the same pass: doubling the engine's acceleration led the
 *  full-health table outright. */
export const PYROCLAST_4PC_COMBUSTION_CDR_PER_CRIT = 1.5;
/** Frostquench 2pc: extra Icicles a Rimelance CRITICAL banks on top of the
 *  base per-impact Icicle (cap ICICLE_MAX 5 untouched and load-bearing). */
export const FROSTQUENCH_2PC_CRIT_BONUS_ICICLES = 1;
/** Frostquench 4pc: Winter's Chill charges Winterlash plants (base
 *  WINTERS_CHILL_CHARGES 2). */
export const FROSTQUENCH_4PC_WINTERS_CHILL_CHARGES = 3;

// Audited constants for the bespoke warlock bends (read by the class-module
// call sites AND pinned by tests, so the copy cannot drift from the code).
/** Hexthread 2pc: extra Condemnation on the RESOLVED afflictionNeedle payload
 *  (base doom 7 on the needle_of_fate effect). The bonus is a resolved-ability
 *  rewrite in applyTalentMods, so the dispatch (resolveNeedleOfFate) and the
 *  {needleDoom} tooltip splice read the ONE resolved number and can never
 *  diverge. eyeGeneration still multiplies the total afterward: on a secondary
 *  Coven Eye the x0.5-with-rounding pays +1 (a +1 bonus would pay zero there),
 *  and under Hour of Judgment the primary-Eye x2 pays +4, both disclosed by
 *  the set doc. Income lift on the needle source only: the drain, death, and
 *  enemy-action streams keep their base amounts. */
export const HEXTHREAD_2PC_NEEDLE_DOOM_BONUS = 2;
/** Hexthread 4pc: Condemnation refunded after a resolved Sentence, at the
 *  post-consume site beside Hour of Judgment's once-per-90s 50-refund charge
 *  (additive with it; near-moot overlap, stated by the set doc). Flagged as
 *  the tuning pass's first shave, per the set doc. */
export const HEXTHREAD_4PC_SENTENCE_DOOM_REFUND = 10;
/** Gravebrand 2pc: seconds cut from Reaping Command's cooldown (base 8; the
 *  honest claim is +33 percent Reaping Commands, cooldown-bound in the probe).
 *  The Soul Fragment bank and the 2-fragment cost are deliberately untouched:
 *  the bank stays pinned, it never "breathes". */
export const GRAVEBRAND_2PC_REAPING_COOLDOWN_CUT_SEC = 2;
/** Gravebrand 4pc: multiplier on reapingDamage, the unison-strike roll with
 *  exactly ONE caller (combat/necromancy.ts reapWithUndead), so the bend
 *  scopes to command strikes and carries into the Gravewing cleave (which
 *  derives from the same damage). No printed numbers exist for the strikes. */
export const GRAVEBRAND_4PC_UNISON_DAMAGE_MULT = 1.25;
/** Ruincaller 2pc: extra stored Conflagrate use (native maxCharges 2 -> 3;
 *  parallel per-charge recharge, so up to +50 percent throughput, net reduced
 *  by Burning Pact self-burn and Desolation overcap, both disclosed). */
export const RUINCALLER_2PC_CONFLAGRATE_BONUS_CHARGES = 1;
/** Ruincaller 4pc: the chaos_bolt dmgPct row. The printed number is 20
 *  percent DELIVERED: the accumulator is additive (talent_hit_mult.ts,
 *  1 + spellDmgPct + dmgPct) and a committed Ruination carries the 0.1
 *  spec-baseline spellDmgPct floor (spec_baselines.ts), so the real baseline
 *  is 1.1 and the row is 0.2 x 1.1 = 0.22 (1.32 / 1.1 = 1.20 exactly). The
 *  set doc's bracketed 0.2 assumed a bare 1.0 baseline (the Warspirit 4pc
 *  deviation shape); recorded as a deviation in the wave's PR notes. */
export const RUINCALLER_4PC_CHAOS_BOLT_DMG_PCT = 0.22;

// Audited constants for the bespoke druid bends (read by the class-module
// call sites AND pinned by tests, so the copy cannot drift from the code).
/** Moonscorch 2pc: Moonseed's per-application Lunar Tempest extension cap
 *  (base extendDot maxBonus 6). The RESOLVED effect is rewritten in
 *  applyTalentMods, the ONE number the extendOwnedDot dispatch and the
 *  {duration} description splice both read: two 6-sec extensions fit per
 *  application, and the third press stays dead (the set doc's honesty note). */
export const MOONSCORCH_2PC_TEMPEST_EXTEND_CAP_SEC = 12;
/** Moonscorch 4pc: the moonlash/sunlance dmgPct row. The printed number is 25
 *  percent DELIVERED: the accumulator is additive (talent_hit_mult.ts,
 *  1 + spellDmgPct + dmgPct) and a committed Moongrove at the raid's level
 *  20+ carries the 0.08 spec-baseline spellDmgPct floor PLUS the fully
 *  scaled Moonrage mastery's 0.15, so the real baseline is 1.23 and the row
 *  is 0.25 x 1.23 = 0.3075 (1.5375 / 1.23 = 1.25 exactly). The set doc's
 *  bracketed dmgPct assumed a bare baseline (the Warspirit 4pc deviation
 *  shape); recorded as a deviation in the wave's PR notes. */
export const MOONSCORCH_4PC_PAYOFF_DMG_PCT = 0.3075;
/** Wildfang 2pc: multiplier on Redharvest's RESOLVED gainResource energy
 *  restore (base rank ladder 15/22/30; Math.floor lands the bent ladder at
 *  22/33/45, the set doc's rank truth, with 45 the raid-tier rank-3 value the
 *  copy prints). Rewritten in applyTalentMods, so the dispatch's resource
 *  grant reads the one resolved amount; no tooltip literal exists to drift. */
export const WILDFANG_2PC_REDHARVEST_ENERGY_MULT = 1.5;
/** Cinderbark 2pc: chance a landed Sweeping Claws banks an ADDITIONAL Old
 *  Blood (rolled once per landed cast at the druidEngineOnLandedStrike bank
 *  site). WEARER-ONLY rng: the roll is flag-gated, so non-wearers draw
 *  nothing and their stream stays byte-identical (doc-disclosed shift). */
export const CINDERBARK_2PC_EXTRA_OLD_BLOOD_CHANCE = 0.3;
/** Cinderbark 4pc: the marrowbreak dmgPct row. The printed number is 30
 *  percent DELIVERED: a committed Wildfang at the raid's level 20+ carries
 *  the fully scaled Primal Heart mastery's 0.5 meleeDmgPct (no other row
 *  targets marrowbreak), so the baseline is 1.5 and the row is
 *  0.3 x 1.5 = 0.45 (1.95 / 1.5 = 1.30 exactly). */
export const CINDERBARK_4PC_MARROWBREAK_DMG_PCT = 0.45;
/** Grovespring 2pc: multiplier on Swiftmend's RESOLVED consumeAura heal
 *  (bespoke eff.heal rewrite in applyTalentMods, the set doc's named hook:
 *  no generic knob reaches the consumeAura heal without folding into the
 *  additive baseline). The $d tooltip splice reads the same resolved range,
 *  so the printed heal stays honest for wearers. The healPower rider on top
 *  keeps its base scaling, disclosed in the wave's PR notes. */
export const GROVESPRING_2PC_SWIFTMEND_HEAL_MULT = 1.25;
/** Grovespring 4pc: Overbloom's RESOLVED harvest fraction (base
 *  druidOverbloom harvestPct 0.6). Rewritten in applyTalentMods, the ONE
 *  number resolveDruidOverbloom and the {buff} description splice both read. */
export const GROVESPRING_4PC_OVERBLOOM_HARVEST_PCT = 0.75;
/** Grovespring 4pc: Verdance banked after Overbloom resolves, via
 *  setBank(current + 1) DIRECTLY (never addStage, which would silently pay
 *  Quickening's per-stage reward), placed AFTER the Nature's Fury seed so the
 *  two are additive beside each other. */
export const GROVESPRING_4PC_VERDANCE_BANK = 1;

/** The engine payloads, keyed by set id (the `set` tag on each member item
 *  and the ItemSet id in item_sets.ts). Tiers ascend by pieces. */
export const SET_ENGINE_BONUSES: Record<string, readonly SetEngineBonusTier[]> = {
  // ---- Warrior ----
  slagbreaker: [
    {
      pieces: 2,
      // Redhand's Maiming Strike empower rises 20 -> 30 percent per stack:
      // buffPct scales the selfBuff value at cast (stack cap 2 untouched).
      effect: { ability: [{ ability: 'overpower', buffPct: 0.5 }] },
    },
    {
      pieces: 4,
      // Every SECOND Redhand cast refunds Breachmaker cooldown: n:2 is the
      // adversarial-round sizing (Redhand's two parallel charges sustain ~1
      // cast per 2.5s, so n:1 would out-refund the cooldown's own ticking),
      // and the tooltip text says "every second cast" to match honestly.
      // Generic proc machinery: castNth draws no rng without a chance field,
      // so non-wearers and wearers alike keep their rng streams.
      effect: {
        proc: {
          id: 'set_slagbreaker_4pc',
          name: 'Slagbreaker Momentum',
          trigger: { on: 'castNth', n: 2, abilities: ['overpower'] },
          responses: [
            {
              kind: 'cooldownRefund',
              ability: 'breachmaker',
              seconds: SLAGBREAKER_4PC_BREACHMAKER_REFUND_SEC,
            },
          ],
        },
        tuning: { breachmakerRefundSec: SLAGBREAKER_4PC_BREACHMAKER_REFUND_SEC },
      },
    },
  ],
  emberfury: [
    {
      pieces: 2,
      // Enrage 4 -> 6 sec on BOTH sources: durationFlat rewrites the
      // RESOLVED enrageChance durations (applyTalentMods' rewrite-list
      // extension), so the engine and the tooltip read the same number.
      // Disclosed in the set doc: Enrage carries +25 percent attack speed,
      // a haste-to-swings rage-income coupling watched in tuning.
      effect: {
        ability: [
          { ability: 'bloodthirst', durationFlat: EMBERFURY_2PC_ENRAGE_DURATION_BONUS },
          { ability: 'red_harvest', durationFlat: EMBERFURY_2PC_ENRAGE_DURATION_BONUS },
        ],
        tuning: { enrageDurationBonusSec: EMBERFURY_2PC_ENRAGE_DURATION_BONUS },
      },
    },
    {
      pieces: 4,
      // Bespoke: Bloodletting's enrage roll is SKIPPED (always Enrages;
      // wearers legitimately shift the rng stream, disclosed for seeded
      // suites) and its self-heal rises to 8 percent of max health.
      effect: { tuning: { bloodlettingHealPctMax: EMBERFURY_4PC_BLOODLETTING_HEAL_PCT_MAX } },
    },
  ],
  forgewall: [
    {
      pieces: 2,
      // Iron Resolve converts rage at 5 absorb per point instead of 4: the
      // buffPct row scales the RESOLVED absorbSpentResource mult (4 x 1.25,
      // applyTalentMods' scaleEffect extension), so the dispatch and the
      // tooltip read the same rate. No cross-ability collateral: the row is
      // scoped to iron_resolve alone.
      effect: {
        ability: [{ ability: 'iron_resolve', buffPct: 0.25 }],
        tuning: { absorbPerRage: FORGEWALL_2PC_ABSORB_PER_RAGE },
      },
    },
    {
      pieces: 4,
      // Each Shieldcrack cast (ability id shield_slam) refunds Iron Resolve
      // cooldown. 2 not 3: Colossal Might compounding at 3 drove the
      // effective cooldown under the 10s absorb, destroying the undrained
      // remainder via same-id refresh (the set doc's sizing note).
      effect: {
        proc: {
          id: 'set_forgewall_4pc',
          name: 'Forgewall Tempering',
          trigger: { on: 'castNth', n: 1, abilities: ['shield_slam'] },
          responses: [
            {
              kind: 'cooldownRefund',
              ability: 'iron_resolve',
              seconds: FORGEWALL_4PC_IRON_RESOLVE_REFUND_SEC,
            },
          ],
        },
        tuning: { ironResolveRefundSec: FORGEWALL_4PC_IRON_RESOLVE_REFUND_SEC },
      },
    },
  ],
  // ---- Paladin ----
  dawnforged: [
    {
      pieces: 2,
      // Beacon of Light copies 55 percent instead of 50: bespoke bend at the
      // beacon placement (combat/paladin_beacon.ts bakes the wearer fraction
      // into the aura value; heal.ts's transfer arithmetic reads that value).
      // The healer 2pc pushback rider rides the GENERIC global knob:
      // castPushbackReduction 1 folds into the recalc alongside the stat-set
      // sources (max-combined), so damage taken no longer delays casting.
      effect: {
        global: { castPushbackReduction: 1 },
        tuning: { beaconHealFraction: DAWNFORGED_2PC_BEACON_HEAL_FRACTION },
      },
    },
    {
      pieces: 4,
      // The Radiant Resonance empowered Dawn's Embrace goes 1.5 sec -> instant:
      // bespoke bend on the ONE cast-time knob (radiantResonanceCastTime),
      // keyed on abilityId so the Mending Light instant arm and every other
      // cast stay untouched. Billing and the aura consume ride the existing
      // instant-cast machinery (the Ascension-instant path), so no rng draw
      // moves for anyone.
      effect: { tuning: { radiantResonanceDawnCastTime: DAWNFORGED_4PC_DAWN_CAST_TIME } },
    },
  ],
  oathpyre: [
    {
      pieces: 2,
      // Solar Reprisal arms more often: bespoke chance selection at the ONE
      // grant site (tryGrantSolarReprisal). The same single rng draw happens
      // either way, only the threshold moves, so no stream shift for wearers
      // or non-wearers. No internal cooldown exists: a re-arm while armed
      // refreshes the one aura (same id + source), the disclosed soft cap.
      effect: {
        tuning: {
          vowkeeperArmChance: OATHPYRE_2PC_VOWKEEPER_CHANCE,
          blockArmChance: OATHPYRE_2PC_BLOCK_CHANCE,
        },
      },
    },
    {
      pieces: 4,
      // Consuming Solar Reprisal (any of the THREE consumers: Sunward Disc,
      // Hammer of Grace, or Mending Light; the heal route is deliberate)
      // shields for 6 percent of max health for 10 sec. Fixed aura id, so the
      // three consumers refresh ONE absorb; a refresh replaces the undrained
      // remainder (the same-id semantics disclosed for Forgewall 4pc).
      effect: {
        tuning: {
          shieldPctMaxHp: OATHPYRE_4PC_SHIELD_PCT_MAX,
          shieldDurationSec: OATHPYRE_4PC_SHIELD_DURATION_SEC,
        },
      },
    },
  ],
  zealfire: [
    {
      pieces: 2,
      // Final Edict and Dawnfall cut each other's cooldown by 3 sec instead
      // of 2: bespoke reduction selection fed into triggerPaladinDawnRhythm
      // at both dispatch sites (the fixpoint sizing verified in band by the
      // set doc). Deterministic, no rng involved.
      effect: { tuning: { dawnRhythmCutSec: ZEALFIRE_2PC_DAWN_RHYTHM_CUT_SEC } },
    },
    {
      pieces: 4,
      // Hammer of Wrath under Dawn's Wrath strikes 40 percent harder, up
      // from 20. The wearer mult is baked into the AURA VALUE at grant and
      // the consume reads the aura back, so the HUD's dynamic {pct} print
      // stays honest for every wearer. Multiplicative with Ascension's 1.3
      // (1.82 total), disclosed by the set doc.
      effect: { tuning: { dawnsWrathDamageMult: ZEALFIRE_4PC_DAWNS_WRATH_DAMAGE_MULT } },
    },
  ],
  // ---- Hunter ----
  packlord_emberhide: [
    {
      pieces: 2,
      // Pack Command 4 -> 3 sec: a cooldownPct row on the resolved entry, so
      // the engine's cooldown set and the tooltip's printed cooldown line read
      // the same number. Roughly +13 percent Unleash cadence (the set doc's
      // third-round arithmetic: three casts span two cooldown intervals plus
      // the fixed 8s frenzy lockout); dead inside Howling Rage, accepted.
      effect: { ability: [{ ability: 'pack_command', cooldownPct: -0.25 }] },
    },
    {
      pieces: 4,
      // Bespoke: the Stampede reset roll's threshold rises 0.2 -> 0.3 at the
      // ONE tryResetStampede draw (combat/hunter_packlord.ts). The same single
      // rng draw happens either way, only the threshold moves; the 5-fail
      // bad-luck cap asserts base behavior and stays untouched.
      effect: { tuning: { stampedeResetChance: PACKLORD_4PC_STAMPEDE_RESET_CHANCE } },
    },
  ],
  coldsight_trackers: [
    {
      pieces: 2,
      // Bespoke: +5 Focus on Measured Shot via the named module hook AFTER
      // the Cold Focus absolute rewrite (combat/hunter_coldsight.ts): no
      // flat-resource key exists and an addEffects row would double-map, so
      // the hook bends the resolved gainResource amount (20 -> 25; 30 -> 35
      // inside the window; the shared resolver's Harrier multiplier lands
      // after, the disclosed 38/53).
      effect: { tuning: { measuredShotFocusBonus: COLDSIGHT_2PC_MEASURED_SHOT_FOCUS_BONUS } },
    },
    {
      pieces: 4,
      // Bespoke: Long Draw criticals extend the Cold Focus window 2 sec each,
      // up to 6 per window. The crit already rolled in the shared damage
      // block is observed (one plumbed argument), so no draw moves for
      // anyone; the extension re-derives Apex Instinct (window + 4) and
      // stretches the 2pc's in-window rewrite with it (intra-set
      // compounding, disclosed by the set doc).
      effect: {
        tuning: {
          critExtensionSec: COLDSIGHT_4PC_CRIT_EXTENSION_SEC,
          windowExtensionCapSec: COLDSIGHT_4PC_WINDOW_EXTENSION_CAP_SEC,
        },
      },
    },
  ],
  slagsnare: [
    {
      pieces: 2,
      // Bespoke: the module-constant Gutting Strike focus grant rises
      // 15 -> 20 at the grantHunterFocus call site
      // (combat/hunter_fieldcraft.ts); preResolved stays false so the Harrier
      // and Efficient Rhythm riders apply after, exactly as for the base
      // grant. Deterministic, no rng involved.
      effect: { tuning: { guttingStrikeFocus: SLAGSNARE_2PC_GUTTING_STRIKE_FOCUS } },
    },
    {
      pieces: 4,
      // Bespoke: a Woundrend that consumes 3 Hunting Momentum preserves the
      // stacks, once per 8 sec (the lockout deliberately MATCHES the Momentum
      // window). Scoped to the Woundrend consume site ONLY: the Re-entry
      // consumers still spend the stacks, and payoffs stay at 3-stack value.
      effect: { tuning: { momentumPreserveIcdSec: SLAGSNARE_4PC_MOMENTUM_ICD_SEC } },
    },
  ],
  // ---- Rogue ----
  cinderfang: [
    {
      pieces: 2,
      // Bespoke: the per-builder energy refund rises 15 -> 20 at BOTH
      // VENOM_STAGE_REFUND readers (the Venom Dart grant and the Craven
      // Thrust grant in combat/rogue_engines.ts). The refund stays per
      // qualifying BUILDER CAST, unconditional at the stage cap, and the
      // Wicked Slash fallback keeps its exclusion (the anti-self-funding
      // guard is NOT widened), so a non-dagger build feels nothing
      // (disclosed by the set doc). Deterministic, no rng involved.
      effect: { tuning: { venomStageRefund: CINDERFANG_2PC_VENOM_STAGE_REFUND } },
    },
    {
      pieces: 4,
      // Venom Dart 8 -> 4 sec: a cooldownFlat row on the resolved entry
      // (applyTalentMods adds after cooldownPct and clamps at 0, so the -4
      // lands at exactly 4), so the engine's cooldown set and the printed
      // cooldown line read the same number. The set doc's honesty note: the
      // dominant effect is the ENERGY economy (the dart is net 10 energy vs
      // Craven Thrust's net 45), and about a third of each wound extension
      // overcaps at the 20 sec pin; stages-per-cycle are unchanged so the
      // 6-vs-5 finisher alternation stays structurally intact.
      effect: { ability: [{ ability: 'venom_dart', cooldownFlat: -4 }] },
    },
  ],
  smolderstrike: [
    {
      pieces: 2,
      // Haymaker (body_blow, the Wicked Slash transform inside the Redline
      // run) hits 20 percent harder: a dmgPct row. The transform re-bake in
      // Sim.resolvedAbility (the applyTalentMods pass keyed by the FINAL id
      // after resolveActionReplacement) is what carries an ability row onto
      // a transformed weaponStrike at all. DELIVERED +17.2 percent: the
      // additive accumulator folds the row beside Thuggery's 0.16 global
      // (1.36 / 1.16, stated by the set doc).
      effect: { ability: [{ ability: 'body_blow', dmgPct: 0.2 }] },
    },
    {
      pieces: 4,
      // Lights Out (knockout_blow, the Dirt Nap transform) refunds Mirrored
      // Blades (blade_flurry), unconditional: the cast funnel reports the
      // TRANSFORMED id, so castNth n:1 sees every Lights Out. Refunds that
      // land while Mirrored Blades is off cooldown are dropped by the
      // talent_procs guard (disclosed). castNth draws no rng without a
      // chance field, so wearers and non-wearers keep their rng streams.
      effect: {
        proc: {
          id: 'set_smolderstrike_4pc',
          name: 'Smolderstrike Rhythm',
          trigger: { on: 'castNth', n: 1, abilities: ['knockout_blow'] },
          responses: [
            {
              kind: 'cooldownRefund',
              ability: 'blade_flurry',
              seconds: SMOLDERSTRIKE_4PC_MIRRORED_BLADES_REFUND_SEC,
            },
          ],
        },
        tuning: { mirroredBladesRefundSec: SMOLDERSTRIKE_4PC_MIRRORED_BLADES_REFUND_SEC },
      },
    },
  ],
  ashveil: [
    {
      pieces: 2,
      // Lurker's Strike hits 25 percent harder: a dmgPct row on the
      // resolved ambush entry. DELIVERED ~+20 percent: the additive
      // accumulator folds the row beside the spec baseline's 0.16 ambush
      // row and the 0.08 global (1.49 / 1.24, stated by the set doc); the
      // in-veil Veiled Edge multiplier applies to the scaled weapon
      // component afterward.
      effect: { ability: [{ ability: 'ambush', dmgPct: 0.25 }] },
    },
    {
      pieces: 4,
      // Bespoke: the Veiled Edge bonus 1 -> 2 is baked into the edge aura
      // VALUE at arm time (the wearer is known at the detonation), and
      // consumeVeiledEdge already returns 1 + edge.value, so the consume
      // reads the triple back dynamically. Deterministic, no rng involved.
      effect: { tuning: { veiledEdgeBonus: ASHVEIL_4PC_VEILED_EDGE_BONUS } },
    },
  ],
  // ---- Priest ----
  emberscreed: [
    {
      pieces: 2,
      // Bespoke: +0.10 ADDITIVE on the Doctrine link conversion, on BOTH twin
      // branches at placeDoctrineLink (combat/priest/doctrine.ts): 0.3 -> 0.4
      // base and 0.7 -> 0.8 under Twin Covenant. The rate is baked into the
      // link aura VALUE at placement, so links placed before a gear change
      // keep their placed rate for up to the 30 sec link duration
      // (snapshot-at-placement); the 0.15 no-link fallback stays untouched.
      // The healer/caster 2pc pushback rider rides the generic global knob.
      // Deterministic, no rng involved.
      effect: {
        global: { castPushbackReduction: 1 },
        tuning: { doctrineConversionBonus: EMBERSCREED_2PC_DOCTRINE_CONVERSION_BONUS },
      },
    },
    {
      pieces: 4,
      // A fully consumed Psalm of Warding makes the next Scouring Hymn
      // (ability id smite) within 10 sec instant, once per 15 sec. Generic
      // proc machinery on the shieldConsumed trigger; the trigger's optional
      // internal cooldown is this bonus's extension of that trigger (the
      // castNth/spellCrit icds-map idiom in combat/talent_procs.ts). Draws no
      // rng; the aura NAME deliberately reuses the localized 'Scouring Hymn'
      // ability string, so no new sim_i18n dictionary row is needed.
      effect: {
        proc: {
          id: 'set_emberscreed_4pc',
          name: 'Scouring Hymn',
          trigger: {
            on: 'shieldConsumed',
            ability: 'power_word_shield',
            icd: EMBERSCREED_4PC_HYMN_ICD_SEC,
          },
          responses: [
            {
              kind: 'empowerNext',
              aura: 'next_cast_instant',
              abilities: ['smite'],
              duration: EMBERSCREED_4PC_HYMN_WINDOW_SEC,
            },
          ],
        },
        tuning: {
          hymnWindowSec: EMBERSCREED_4PC_HYMN_WINDOW_SEC,
          hymnIcdSec: EMBERSCREED_4PC_HYMN_ICD_SEC,
        },
      },
    },
  ],
  benison_dawnweave: [
    {
      pieces: 2,
      // Seraphic Vigil's rescue 180 -> 270: buffPct 0.5 scales the RESOLVED
      // buffTarget heal_echo value (heal_echo is in neither the integral nor
      // the scalable buff-kind sets, so the resolved value is exactly the
      // flat 270 the tooltip promises). The {buff} description splice
      // reads the same resolved value, so the printed number stays honest
      // for wearers and everyone else. Deterministic, no rng involved.
      effect: {
        ability: [{ ability: 'seraphic_vigil', buffPct: 0.5 }],
        global: { castPushbackReduction: 1 },
        tuning: { vigilRescueHeal: BENISON_2PC_VIGIL_RESCUE_HEAL },
      },
    },
    {
      pieces: 4,
      // Bespoke: when a Vigil triggers, its ally is also mended for 15
      // percent of the ALLY'S max health over 10 sec. Hooked at the
      // vigil-trigger POINT in damage.ts beside priestOnVigilTriggered
      // (which stays talent-gated for Incarnate Spirit; the set arm is
      // flag-gated instead, combat/priest/benison.ts). Replaces the killed
      // cooldown-reset idea: Twin Covenant's charge model deletes the
      // cooldowns entry, making cooldownRefund a hard no-op. Draws no rng.
      effect: {
        tuning: {
          mendPctMaxHp: BENISON_4PC_MEND_PCT_MAX,
          mendDurationSec: BENISON_4PC_MEND_DURATION_SEC,
          mendTickIntervalSec: BENISON_4PC_MEND_TICK_INTERVAL_SEC,
        },
      },
    },
  ],
  vesperash: [
    {
      pieces: 2,
      // Call Tithefiend 30 -> 24 sec: a cooldownFlat row on the resolved
      // entry, so the engine's cooldown set and the HUD's printed cooldown
      // read the same number. Honest sizing note from the set doc: the
      // Gloomtithe bank still saturates roughly 13 of every 24 sec; the gain
      // is about +25 percent full-strength fiend uptime. Deterministic.
      effect: {
        ability: [
          {
            ability: 'summon_tithefiend',
            cooldownFlat: -VESPERASH_2PC_TITHEFIEND_COOLDOWN_CUT_SEC,
          },
        ],
        global: { castPushbackReduction: 1 },
      },
    },
    {
      pieces: 4,
      // Calling the Tithefiend resets Mindfracture (ability id mind_blast):
      // castNth n:1 sees every Call Tithefiend cast and the 'reset' refund
      // clears the whole cooldown (castNth draws no rng without a chance
      // field). The doubled per-hit mana return is a bespoke call-site
      // multiplier in combat/priest/vespers.ts; the base rate constant and
      // its literal test pin stay untouched for everyone else.
      effect: {
        proc: {
          id: 'set_vesperash_4pc',
          name: 'Vesperash Communion',
          trigger: { on: 'castNth', n: 1, abilities: ['summon_tithefiend'] },
          responses: [{ kind: 'cooldownRefund', ability: 'mind_blast', seconds: 'reset' }],
        },
        tuning: { manaReturnMult: VESPERASH_4PC_MANA_RETURN_MULT },
      },
    },
  ],
  // ---- Shaman ----
  stormkindled: [
    {
      pieces: 2,
      // Unleash Weapon on Pyrebrand grants 3 Thunder instead of 2: a constant
      // bend at the ONE grant site (combat/shaman_unleash_weapon.ts,
      // applyPyrebrandUnleash). With 3 or more already banked part of the
      // grant overcaps at the 5-charge cap (disclosed). The caster 2pc
      // pushback rider rides the generic global knob. Deterministic for
      // everyone: the Unleash damage and crit rolls are unchanged, only the
      // rng-free grant amount moves.
      effect: {
        global: { castPushbackReduction: 1 },
        tuning: { pyrebrandUnleashThunder: STORMKINDLED_2PC_UNLEASH_THUNDER },
      },
    },
    {
      pieces: 4,
      // Earthen Jolt's per-Thunder vent bonus 0.25 -> 0.30 at the ONE
      // thundercallDamageMultiplier read (combat/shaman_thundercall.ts): the
      // full 5-charge vent goes 2.25x -> 2.5x, and Primal Mastery's 1.25 vent
      // window still MULTIPLIES the result (3.125x in-window, disclosed).
      // Faultwake's earthquake coefficient is deliberately untouched. The two
      // printed "125 percent" totals (the thunder_reservoir passive and the
      // earth_shock description) stay static text: no resolved value
      // parameter reaches them, and every shipped wave leaves such baseline
      // literals static (the paladin vowkeeper chances, the warrior Enrage
      // duration), so they are flagged to the maintainer rather than given
      // new tooltip plumbing here.
      effect: {
        tuning: { earthenJoltBonusPerThunder: STORMKINDLED_4PC_EARTHEN_JOLT_BONUS_PER_CHARGE },
      },
    },
  ],
  warspirit_emberscale: [
    {
      pieces: 2,
      // Ancestral Strike advances the cadence 3 steps instead of 2: the
      // steps-parameter widening in combat/shaman_warspirit.ts plus call-site
      // selection in combat/auto_attack.ts. Disclosed: under Primal
      // Exaltation the cadence target clamps to 2, so a 3-step strike
      // completes and carries min(1, total - 2); Deep Reservoir shares the
      // same cadence currency (its Stormcast-consume refund starts the next
      // loop at 1), an amplification, not a duplication. Draws no rng.
      effect: {
        tuning: { ancestralStrikeCadenceSteps: WARSPIRIT_EMBERSCALE_2PC_CADENCE_STEPS },
      },
    },
    {
      pieces: 4,
      // Ancestral Strike hits 30 percent harder, DELIVERED: the additive
      // accumulator (talent_hit_mult.ts) folds this row beside the 0.6
      // spec-baseline stormstrike row and the fully scaled Skyrend mastery's
      // 0.1 meleeDmgPct, so the committed-spec baseline is 1.7 and the row
      // is 0.51 (2.21 / 1.7 = 1.30 exactly; the constant's doc note records
      // the set doc's 0.48-vs-0.51 deviation). The stormstrike tooltip's
      // {damage} splice reads the resolved effect, so the printed number
      // tracks the bend for wearers automatically. No other row targets
      // stormstrike, so there is no row overlap.
      effect: {
        ability: [{ ability: 'stormstrike', dmgPct: WARSPIRIT_EMBERSCALE_4PC_STORMSTRIKE_DMG_PCT }],
      },
    },
  ],
  stonehearth: [
    {
      pieces: 2,
      // While Stonebound, a Stormcast Mending Waters bills no mana and heals
      // 25 percent more (combat/shaman_stonehearth.ts, consumed at the
      // casting_lifecycle Stormcast sites). Consume order (the set doc's
      // note): the bill is zeroed only AFTER the Stormcast cheap charge is
      // consumed, so the half-cost aura can never survive into a later cast;
      // the heal bonus reaches the WHOLE resolved heal (authored roll plus
      // the Spell Power rider) through runEffects' cast-scoped multiplier,
      // scoped to that one cast. No pushback rider: the melee tank set.
      // Disclosed: the Elemental Trance dead window and the no-rotation probe
      // are the set doc's accepted gaps. Draws no rng.
      effect: { tuning: { mendingHealBonus: STONEHEARTH_2PC_MENDING_HEAL_BONUS } },
    },
    {
      pieces: 4,
      // Completing a cadence while Stonebound heals 3 percent of max health:
      // a HEAL, never an absorb (distinct from Living Weapon's absorb, which
      // arms on the Stormcast CONSUME in onStormcastConsumed, a different
      // site; no id or site collision). canCrit false, so the heal draws NO
      // rng. Disclosed: Primal Exaltation's 2-step cadence target spikes the
      // completion rate and with it this heal's uptime; the ~1 percent max
      // health per second derivation is swing-rate dependent (set doc flag).
      effect: { tuning: { cadenceHealPctMaxHp: STONEHEARTH_4PC_CADENCE_HEAL_PCT_MAX } },
    },
  ],
  springmender: [
    {
      pieces: 2,
      // Tidecall 12 -> 8 sec: a cooldownFlat row on the resolved entry, which
      // the charge model reads as each charge's PARALLEL recharge duration
      // (casting_lifecycle's chargeState), so this is +50 percent Tidecall
      // throughput (the set doc's honesty note). No printed cooldown
      // literals exist for Tidecall. Deep Reservoir's Lifespring arm
      // amplifies the extra deposits (disclosed: amplification, not
      // duplication). The healer 2pc pushback rider rides the generic global
      // knob. Deterministic.
      effect: {
        ability: [
          { ability: 'tidecall', cooldownFlat: -SPRINGMENDER_2PC_TIDECALL_COOLDOWN_CUT_SEC },
        ],
        global: { castPushbackReduction: 1 },
      },
    },
    {
      pieces: 4,
      // Cascading Mend reaches a FOURTH ally (jumps 2 -> 3, bespoke: no
      // talent primitive reaches chainHeal's jump count, so the bend lives at
      // the dispatch in combat/effect_dispatch.ts) and the CHAIN-path Mending
      // Current harvest rises to 150 percent (scoped to consumeMendingCurrent
      // in combat/shaman_spiritmend.ts; Unleash Weapon's collapse keeps
      // 1.25). The fourth hop consumes that ally's pool at the same full
      // value. Wearer-only rng note, disclosed: the extra hop draws its own
      // heal-crit roll; non-wearers draw exactly as before.
      effect: {
        tuning: {
          bonusJumps: SPRINGMENDER_4PC_BONUS_JUMPS,
          chainHarvestMult: SPRINGMENDER_4PC_CHAIN_HARVEST_MULT,
        },
      },
    },
  ],
  // ---- Mage ----
  chronoweave: [
    {
      pieces: 2,
      // Temporal Echo converts 50 percent of single-target Arcane damage
      // instead of 40: bespoke bend at placeTemporalEcho, the ONE placement
      // write whose baked rate both combat (echoConvertRate) and the aura
      // tooltip (value) read back. Snapshot-at-placement: a mark placed
      // before a gear change keeps its placed rate until re-cast. The UI
      // group-mark classifier (value <= 0.13) stays safe at 0.5, and the
      // echoRateFor fallback keeps base for legacy marks that never carried
      // echoConvertRate. The healer 2pc pushback rider rides the generic
      // global knob. Deterministic, no rng involved.
      effect: {
        global: { castPushbackReduction: 1 },
        tuning: { echoConvertSingle: CHRONOWEAVE_2PC_ECHO_CONVERT_SINGLE },
      },
    },
    {
      pieces: 4,
      // Temporal Cascade 17 -> 12 sec: a cooldownFlat row on the resolved
      // entry, so the engine's cooldown set and the HUD's printed cooldown
      // read the same number. Touches no rate constants, no classifier, no
      // wire (the set doc's final-round sizing); no talent row targets
      // temporal_cascade, so there is no row overlap. Deterministic.
      effect: {
        ability: [
          {
            ability: 'temporal_cascade',
            cooldownFlat: -CHRONOWEAVE_4PC_CASCADE_COOLDOWN_CUT_SEC,
          },
        ],
      },
    },
  ],
  pyroclast: [
    {
      pieces: 2,
      // Scald always crits at or below 50 percent health instead of 30: the
      // execute threshold moves at the SOLE functional reader
      // (fireGuaranteedCrit in combat/fire_mage.ts). The crit roll is STILL
      // drawn exactly as before (only the outcome is overridden), so the
      // shared rng draw order never moves for wearers or non-wearers. The
      // caster 2pc pushback rider rides the generic global knob. The set
      // doc's centerpiece, tuning-flagged.
      effect: {
        global: { castPushbackReduction: 1 },
        tuning: { scaldExecuteHp: PYROCLAST_2PC_SCALD_EXECUTE_HP },
      },
    },
    {
      pieces: 4,
      // Builder crits outside Phoenix Trance shave 2 sec off its cooldown
      // instead of 1: the constant selection at the ONE shave site in
      // fireMageOnSpellHit. Honest trigger scope (the set doc's disclosure):
      // only the Hot Streak builders feed the seam; Meteor's ground impact
      // and Ignite ticks never reach noteSpellHit and pay nothing.
      // Deterministic, no rng involved.
      effect: { tuning: { combustionCdrPerCrit: PYROCLAST_4PC_COMBUSTION_CDR_PER_CRIT } },
    },
  ],
  frostquench: [
    {
      pieces: 2,
      // Rimelance criticals bank a SECOND Icicle: the crit is observed at the
      // noteSpellHit seam (frostMageOnSpellHit in combat/frost_mage.ts),
      // because the base bank site in frostMageAfterCast cannot see the crit
      // flag. The 5-Icicle cap stays untouched and load-bearing (its three
      // hardcoded readers keep it), and Frozen Orb pulses stay single-bank
      // (the set doc's disclosed dead zone). gainIcicle draws no rng, so the
      // stream is byte-identical for everyone. The caster 2pc pushback rider
      // rides the generic global knob.
      effect: {
        global: { castPushbackReduction: 1 },
        tuning: { rimelanceCritBonusIcicles: FROSTQUENCH_2PC_CRIT_BONUS_ICICLES },
      },
    },
    {
      pieces: 4,
      // Winterlash plants 3 Winter's Chill charges instead of 2: the charge
      // selection at BOTH applyWintersChill branches (refresh + fresh plant).
      // The debuff's HUD tooltip prints its live charge count, so the wearer
      // reads 3 dynamically; the disclosed honest limits (Fingers-priority
      // suppression, Glacial Spike GCD contention, Rimelance displacement)
      // are the set doc's. Deterministic, no rng involved.
      effect: { tuning: { wintersChillCharges: FROSTQUENCH_4PC_WINTERS_CHILL_CHARGES } },
    },
  ],
  // ---- Warlock ----
  hexthread: [
    {
      pieces: 2,
      // Needle of Fate grants 2 additional Condemnation: a resolved-ability
      // rewrite in applyTalentMods bakes the bonus into the afflictionNeedle
      // payload, the ONE number resolveNeedleOfFate and the {needleDoom}
      // tooltip splice both read. eyeGeneration multiplies the total after
      // (x0.5-with-rounding on secondary Coven Eyes pays +1; x2 under Hour of
      // Judgment pays +4; both disclosed). The caster 2pc pushback rider rides
      // the generic global knob. Deterministic, no rng involved.
      effect: {
        global: { castPushbackReduction: 1 },
        tuning: { needleDoomBonus: HEXTHREAD_2PC_NEEDLE_DOOM_BONUS },
      },
    },
    {
      pieces: 4,
      // Passing Sentence refunds 10 Condemnation: bespoke flag-gated refund at
      // the post-consume site in resolveSentence (combat/affliction.ts),
      // additive beside Hour of Judgment's once-per-90s 50-refund charge.
      // Draws no rng; gainDoom is deterministic.
      effect: { tuning: { sentenceDoomRefund: HEXTHREAD_4PC_SENTENCE_DOOM_REFUND } },
    },
  ],
  gravebrand: [
    {
      pieces: 2,
      // Reaping Command 8 -> 6 sec: a cooldownFlat row on the resolved entry,
      // so the engine's cooldown set and the HUD's printed cooldown read the
      // same number (+33 percent Reaping Commands, the set doc's honest
      // sizing; the rotation is cooldown-bound in the probe). No cooldown
      // leak: the row reaches entry.cooldown only, and the reaping rider
      // auras (reaping_command_* ids, fixed 4/5/6 sec durations) are pinned
      // untouched by the wave's tests. The Soul Fragment cost and bank stay
      // pinned. The caster 2pc pushback rider rides the generic global knob.
      effect: {
        ability: [
          {
            ability: 'reaping_command',
            cooldownFlat: -GRAVEBRAND_2PC_REAPING_COOLDOWN_CUT_SEC,
          },
        ],
        global: { castPushbackReduction: 1 },
      },
    },
    {
      pieces: 4,
      // Unison strikes deal 25 percent more: the multiplier lands inside
      // reapingDamage via its ONE caller (reapWithUndead), before the round,
      // so the Gravewing cleave (damage x cleave.mult) carries it too. The
      // wearer is the OWNER, read once per command; pets carry no set-side
      // aura, so an owner gear swap simply changes the next command's read
      // (nothing to orphan or double-apply). Draws no rng.
      effect: { tuning: { unisonDamageMult: GRAVEBRAND_4PC_UNISON_DAMAGE_MULT } },
    },
  ],
  ruincaller: [
    {
      pieces: 2,
      // Conflagrate holds 3 charges: the generic bonusCharges row stacks on
      // the def's native maxCharges 2 (applyTalentMods resolves charges 3 /
      // bonusCharges 2; casting_lifecycle's chargeState reads 1 + bonus = 3).
      // Parallel per-charge recharge, so up to +50 percent throughput, net
      // reduced by Burning Pact self-burn and Desolation overcap (disclosed).
      // The {charges} description splice reads the same resolved count, so
      // the printed line stays honest for wearers and everyone else. An
      // unequip mid-fight clamps the pool through normalizeAbilityCharges
      // (never a free charge). The caster 2pc pushback rider rides the
      // generic global knob. Deterministic.
      effect: {
        ability: [
          { ability: 'conflagrate', bonusCharges: RUINCALLER_2PC_CONFLAGRATE_BONUS_CHARGES },
        ],
        global: { castPushbackReduction: 1 },
      },
    },
    {
      pieces: 4,
      // Ruinbolt strikes 20 percent harder, DELIVERED: the additive
      // accumulator (talent_hit_mult.ts) folds this row beside the committed
      // spec's 0.1 spellDmgPct baseline floor, so the row is 0.22
      // (1.32 / 1.1 = 1.20 exactly; the constant's doc note records the set
      // doc's 0.2-vs-0.22 deviation). The chaos_bolt tooltip's {damage}
      // splice reads the resolved effect, so the printed number tracks the
      // bend for wearers automatically. No other row targets chaos_bolt, so
      // there is no row overlap. Deterministic.
      effect: {
        ability: [{ ability: 'chaos_bolt', dmgPct: RUINCALLER_4PC_CHAOS_BOLT_DMG_PCT }],
      },
    },
  ],
  // ---- Druid ----
  moonscorch: [
    {
      pieces: 2,
      // Moonseed may extend Lunar Tempest twice per application: the resolved
      // extendDot cap goes 6 -> 12 (applyTalentMods rewrite), and the
      // extendedBy bookkeeping already enforces the per-application budget
      // (a fresh Lunar Tempest application replaces the aura object, so the
      // budget resets exactly at the copy's "per application" boundary). The
      // caster 2pc pushback rider rides the generic global knob. Draws no rng.
      effect: {
        global: { castPushbackReduction: 1 },
        tuning: { tempestExtendCapSec: MOONSCORCH_2PC_TEMPEST_EXTEND_CAP_SEC },
      },
    },
    {
      pieces: 4,
      // Moonsurge and Sunwake strike 25 percent harder, DELIVERED: the
      // additive accumulator folds each row beside the committed spec's 0.08
      // spellDmgPct floor plus the Moonrage mastery's 0.15, so the row is
      // 0.3075 (1.5375 / 1.23 = 1.25 exactly; the constant's doc note records
      // the sizing). The rows reach BOTH arms: Sunwake's burn is a plain dot
      // (no directPct, no perCombo), so scaleEffect's dot arm carries the
      // same multiplier into the resolved burn total. Wild Apex's 1.25
      // payoff multiplier stays MULTIPLICATIVE on top (dispatch-side),
      // disclosed. Deterministic, no rng involved.
      effect: {
        ability: [
          { ability: 'moonlash', dmgPct: MOONSCORCH_4PC_PAYOFF_DMG_PCT },
          { ability: 'sunlance', dmgPct: MOONSCORCH_4PC_PAYOFF_DMG_PCT },
        ],
      },
    },
  ],
  wildfang_emberhide: [
    {
      pieces: 2,
      // Redharvest restores 45 energy, up from 30 (rank-3 truth; the ladder
      // is 22/33/45 by rank): a flag-gated rewrite of the resolved
      // gainResource amount in applyTalentMods. No pushback rider: the melee
      // damage set. Deterministic, no rng involved.
      effect: { tuning: { redharvestEnergyMult: WILDFANG_2PC_REDHARVEST_ENERGY_MULT } },
    },
    {
      pieces: 4,
      // Redharvest plants a fresh Flense on the target: aura-only, applied at
      // the druidEngineOnCast redharvest branch (which runs AFTER runEffects,
      // so the consumeDot cash-out has already been paid: no double billing).
      // The replant mirrors the real dot application's value arithmetic
      // (replantFlense in combat/druid_engines.ts) but awards no combo point
      // and banks no Old Blood (the landed-strike hook never fires). The
      // Blooddrunk tick-banking row makes the finisher self-sustaining for
      // that build, the set doc's prominent tuning flag. Draws no rng.
      effect: {},
    },
  ],
  cinderbark: [
    {
      pieces: 2,
      // Sweeping Claws has a 30 percent chance to bank an additional Old
      // Blood: one flag-gated roll per landed cast at the
      // druidEngineOnLandedStrike bank site (the aoe arm reports once per
      // cast that struck anything). WEARER-ONLY rng draw, doc-disclosed;
      // non-wearers draw nothing extra. The 3-stack cap is untouched: the
      // extra bank is the hold-versus-spend tension against the 4pc.
      effect: { tuning: { extraOldBloodChance: CINDERBARK_2PC_EXTRA_OLD_BLOOD_CHANCE } },
    },
    {
      pieces: 4,
      // Marrowbreak hits 30 percent harder (the dmgPct row, DELIVERED
      // against the 1.5 Primal Heart baseline) and its emergency guard no
      // longer replaces the strike: the replacement lives at the ONE
      // directDamage break in effect_dispatch.ts, now flag-gated, so wearers
      // below half health land the strike (with its authored flat-110 mult-2
      // threat) AND keep the guard's absorb and rage refund. Wearer-only rng
      // note, disclosed: the restored strike draws its damage and crit rolls
      // below half health where the base path drew none; non-wearers draw
      // exactly as before.
      effect: {
        ability: [{ ability: 'marrowbreak', dmgPct: CINDERBARK_4PC_MARROWBREAK_DMG_PCT }],
      },
    },
  ],
  grovespring: [
    {
      pieces: 2,
      // Swiftmend prefers the caster's OWN Wildbloom or Second Bloom (the
      // consumeMatchingAura bend), falling back to the base pick when none
      // is present so a paid cast never turns into a silent no-heal (the set
      // doc's explicit fallback), and heals 25 percent more (the bespoke
      // eff.heal rewrite; the $d splice reads the same resolved range). The
      // healer 2pc pushback rider rides the generic global knob. Draws no
      // rng beyond the base heal roll (same count and order for everyone).
      effect: {
        global: { castPushbackReduction: 1 },
        tuning: { swiftmendHealMult: GROVESPRING_2PC_SWIFTMEND_HEAL_MULT },
      },
    },
    {
      pieces: 4,
      // Overbloom harvests 75 percent (the resolved harvestPct rewrite; the
      // {buff} splice reads the same number) and banks 1 Verdance afterward:
      // setBank(current + 1) DIRECTLY after the Nature's Fury seed (additive
      // beside it, not a clone; never addStage, which would silently pay
      // Quickening's reward). The replant is NOT routed through the
      // hot-planted hook, so Seedspread self-arming stays impossible. Draws
      // no rng (Overbloom's heal cannot crit).
      effect: {
        tuning: {
          overbloomHarvestPct: GROVESPRING_4PC_OVERBLOOM_HARVEST_PCT,
          verdanceBank: GROVESPRING_4PC_VERDANCE_BANK,
        },
      },
    },
  ],
};
