// Item sets and their equipped-piece bonuses (classic "tier set" style).
//
// The sets are the epic armor families that drop from the Gravewyrm Sanctum
// (tier 1) and the Nythraxis raid (tier 2), plus three leveling "haste kit"
// families assembled from existing world-drop items. Wearing enough pieces of
// a family grants stacking 2-, 3-, and 4-piece bonuses, resolved in
// `recalcPlayerStats` (primary stats, attack power, crit, haste, cast pushback
// immunity). Every epic family's 4-piece tier is a proc (see SetProc):
// weapon-crit-triggered for the plate and leather archetypes, spell-cast-
// triggered for the caster archetypes, resolved by combat/set_procs.ts.
//
// The five WARFARE honor families the quartermasters sell (content/pvp_honor.ts)
// are the one exception to every sentence around this one: they break at 2, 4
// and 7 pieces rather than 2, 3 and 4, and they are paid entirely in WARFARE
// rating and PvP-gated effects rather than in stats, so they contribute exactly
// zero in PvE. See the WARFARE block below and docs/design/warfare.md.
//
// Bonuses are keyed by archetype: the plate (Strength) families get Strength
// then Strength/Stamina; the leather (Agility) families get Agility then
// Agility/crit; the cloth (caster) families get full spell-pushback immunity
// (damage taken never delays a cast; NOT physical knockback) plus Spell Power at
// 2 pieces and Intellect plus Stamina for tier 1, or Intellect plus Spirit for
// tier 2, at 3 pieces. Every tier-2 3-piece bonus ALSO grants haste (ONE stat:
// faster melee and ranged swings AND shorter casts/channels), and the three
// leveling haste kits grant haste alone at 3 pieces. This file is
// data-as-code: balance numbers live here, never inline in the engine, and every
// one of them is priced by the rule at the top of the constants block below.
// `aggregateSetBonuses` is the pure resolver imported by `entity.ts`.

import type { ItemSet, SetBonusEffect, SetBonusTier, SetProc } from '../types';

// THE PRICING RULE for every tier below. A set bonus is a GARNISH on top of the
// item budget its pieces already ride (item_budget.ts), never a second helping of
// it: at the level-20 cap an epic ilvl-26 chest carries 18 primary-stat points, a
// helmet 15, gloves 13, so one family's whole bonus line stays at or under
// SET_BONUS_POINTS_CEILING, i.e. one chest piece.
//
// Before the v0.38 retune the families paid 35 to 70 points, 1.9x to 3.9x a chest,
// because the bonuses were authored as absolute numbers (40 AP, 20 Spell Power,
// 15+15 primary) that never went through the budget the items do. Measured on a
// level-20 character wearing 4 pieces of one family and 3 of another, set bonuses
// ALONE supplied 47 to 63% of everything gear gave: a warrior at +51% attack power,
// a mage at +63% spell power. The retune lands the same characters at +13 to +21%.
// tests/set_bonus_budget.test.ts re-prices every family (and every reachable
// two-family stack) against this ceiling and is the guard that keeps it true.
export const SET_BONUS_POINTS_CEILING = 18;

// 2-piece: the primary ATTRIBUTE itself, never a derived stat. Granting the
// attribute routes the bonus through each class's own conversion, which is what
// makes one line of data worth the same to everyone who can wear it, and what
// lets the ceiling above price it at all. Neither of the two derived grants this
// replaced could be priced honestly:
//  - `ap: 40` paid unequally. A warrior converts Strength at 2 AP per point but a
//    rogue or hunter converts Strength plus Agility at 1 AP per point, so the
//    identical line was worth 20 budget points to a warrior and 40 to a rogue.
//  - `sp: 20` paid 40 points flat, since Spell Power costs 2 budget points at
//    SPELL_POWER_PER_INT (0.5 per Intellect). Intellect buys the same Spell Power
//    at the budgeted rate and carries the caster's mana pool and spell crit with
//    it, so the cloth families grant it instead.
export const SET_STR_2PC = 6; // plate: 12 AP after the str*2 conversion
export const SET_AGI_2PC = 8; // leather: 8 AP, and feeds crit/dodge/armor too
export const SET_INT_2PC = 6; // cloth: 3 Spell Power, plus mana and spell crit
// 3-piece: a pair of primary attributes, same ceiling reasoning.
export const SET_PRIMARY_3PC = 6;

// Haste granted by a 3-piece bonus after the global combat-rating conversion:
// what SET_HASTE_3PC_RATING is worth once recalcPlayerStats converts it. Read
// only by the tests, deliberately as a literal so it pins the conversion
// independently; it must be updated by hand whenever HASTE_RATING_PER_PCT moves.
//
// Haste is the one stat NO set item carries, so the tier bonus is its entire
// supply and there is no item line to price it against. It is priced against the
// best single ITEM haste allocation in the game instead: a heroic epic helm
// carries 20 rating (1%), so a tier bonus is worth two of those. The old 150
// (7.5%) was seven and a half.
export const SET_HASTE_3PC = 0.02;
export const SET_HASTE_3PC_RATING = 40; // -> 2% haste at 20 rating = 1%
export const SET_CRIT_3PC_RATING = 20; // -> +1% crit at 20 rating = 1%
// The leveling haste kits (below) sit a tier under the raid sets, at one heroic
// item's worth. They MUST stay under SET_HASTE_3PC_RATING: their members are
// level-1 world drops and starter quest rewards, so paying them the raid number
// (which is what shipped) let a level-8 character in three starter greens carry
// the same haste as a fully raid-geared level-20 one, and flattened the entire
// haste progression between the two.
export const SET_HASTE_KIT = 0.01;
export const SET_HASTE_KIT_RATING = 20; // -> 1% haste at 20 rating = 1%
// The two T2 4-piece bleeds (Bonesplinter, Ragged Gash) are marginal on their own.
// They also grant Hit rating so completing the set is worth chasing for Heroic
// (+3 above-level), where the bleed alone was not. Priced against the best single
// item allocation like haste above: a heroic epic helm carries 55 hit rating
// (5.5%), so the tier is worth roughly half of one. The old 60 was a whole helm's
// worth on top of a warrior already carrying 32.5% hit from items.
export const SET_HIT_4PC_RATING = 25; // -> +2.5% hit at 10 rating = 1%

// The WARFARE honor sets (content/pvp_honor.ts). Every tier is paid in WARFARE
// rating or in a PvP-gated effect and never in flat stats, which is what makes
// "honor gear is never better than raid gear in a raid" structural rather than a
// tuning argument: the whole set contributes exactly zero in PvE.
// Breakpoints are 2, 4 and 7 of the seven armor pieces. Seven, not six: with the
// capstone at six the seventh armor slot had one right answer, which was to
// abandon the chest (the most expensive piece with the best PvE replacement) and
// the cheaper hybrid build beat the full kit outright: measured against a
// tier-1-plus-tier-2 reference warrior, 6 armor pieces plus a raid chest, a raid
// weapon and badge jewelry cost 4,200 honor and beat the 5,400-honor full kit.
// At 7 of 7 the same build forfeits both the 22-rating chest AND the 80/80
// capstone and lands clearly worse, which is what a non-choice should look like.
// The GAP between the two builds is the invariant, not either absolute ratio:
// both absolutes were re-zeroed by the v0.38 set-bonus budget retune, since the
// hybrid build swaps in a PvE set piece and the reference warrior IS a set-bonus
// stack. tests/warfare_balance_harness.test.ts holds the live numbers and the
// re-zeroing rationale, and is the guard that keeps this true.
export const WARFARE_SET_2PC_DEFENSE_RATING = 40;
export const WARFARE_SET_4PC_OFFENSE_RATING = 40;
// 0..1 fraction removed from the duration of crowd control cast on the wearer by
// a hostile PLAYER. Max-combines rather than summing (see the resolver).
export const WARFARE_SET_4PC_CC_REDUCTION = 0.15;
// The capstone grants this to BOTH sides. A complete 11-slot kit carries 182 of
// each rating on its own; 182 + 40 + 80 = 302, which clamps to the 0.30 cap with
// two points of rounding slack.
export const WARFARE_SET_7PC_RATING = 80;
// Signature magnitudes. The two absorb wards sit near a level-20 rank-3 mage
// barrier so a capstone signature is a real but not decisive swing.
export const WARFARE_KILL_ABSORB = 200;
export const WARFARE_KILL_ABSORB_DURATION = 10;
// buff_speed carries a 1+fraction multiplier (1.4 = +40% movement speed). Tuned
// for Thornhollow Fields, which is a capture-the-flag mode.
export const WARFARE_KILL_SPEED_MULT = 1.4;
export const WARFARE_KILL_SPEED_DURATION = 6;
export const WARFARE_CAST_ABSORB = 120;
export const WARFARE_CAST_ABSORB_DURATION = 8;
export const WARFARE_CAST_ABSORB_CHANCE = 0.15;
export const WARFARE_CAST_ABSORB_ICD = 20;
// Thornguard, the Thornhide capstone. DODGE rather than another absorb, on
// purpose: this family carries Cinderweave's stats on Ashstalker's armor, so it
// is the furthest ahead of the five and the last one that should be handed more
// effective health. Dodge is avoidance, so it does not compound the stamina
// weighting the caster families already gain against their PvE counterparts, and
// it answers melee pressure, which is the druid's actual weakness. Well under a
// real defensive cooldown for comparison: Evasion is 0.25 and Deterrence 0.30.
export const WARFARE_CAST_DODGE = 0.15;
export const WARFARE_CAST_DODGE_DURATION = 6;
export const WARFARE_CAST_DODGE_CHANCE = 0.15;
export const WARFARE_CAST_DODGE_ICD = 20;

// Set ids. Tier-1 families drop from the Gravewyrm Sanctum; tier-2 from the
// Nythraxis raid. The string is also the `set` tag on each member item.
export const SET_DEATHLORD = 'deathlord'; // t1 plate, Strength
export const SET_WYRMSHADOW = 'wyrmshadow'; // t1 leather, Agility
export const SET_NECROMANCERS = 'necromancers'; // t1 cloth, caster
export const SET_CROWNFORGED = 'crownforged'; // t2 plate, Strength
export const SET_NIGHTTALON = 'nighttalon'; // t2 leather, Agility
export const SET_SOULFLAME = 'soulflame'; // t2 cloth, caster
export const SET_STORMCALLERS = 'stormcallers'; // t2 cloth (shaman), caster
// Leveling haste kits: families of EXISTING world-drop items (each member gets
// the `set` tag on its ItemDef in items.ts; no new item names).
export const SET_VALE_ARCANIST = 'vale_arcanist'; // cloth, caster
export const SET_BOUNDSTONE_VANGUARD = 'boundstone_vanguard'; // mail, melee
export const SET_GREYJAW_STALKER = 'greyjaw_stalker'; // leather, marksman
// WARFARE honor sets: the five armor families the quartermasters sell
// (content/pvp_honor.ts), seven armor pieces each. Neck, rings and weapons carry
// no set tag because they are shared across role profiles.
export const SET_WARFARE_FURYFORGED = 'warfare_furyforged'; // mail, Strength
export const SET_WARFARE_STORMBOUND = 'warfare_stormbound'; // mail, caster
export const SET_WARFARE_ASHSTALKER = 'warfare_ashstalker'; // leather, Agility
export const SET_WARFARE_CINDERWEAVE = 'warfare_cinderweave'; // cloth, caster
export const SET_WARFARE_THORNHIDE = 'warfare_thornhide'; // leather, caster

// Archetype bonus tiers. Tiers stack (a 3-piece set grants both the 2- and
// 3-piece bonuses); cast pushback reduction and knockback resistance
// max-combine (see the resolver).
// Every family reaches its 3-piece tier: tier-1 pieces drop in the Gravewyrm
// Sanctum; tier-2 helms/shoulders drop in the Nythraxis raid and the tier-2
// gloves/belts from the Thunzharr world boss (content/zone3.ts).
const STRENGTH_T1_BONUSES: SetBonusTier[] = [
  { pieces: 2, effect: { str: SET_STR_2PC }, text: 'Increases Strength by 6.' },
  {
    pieces: 3,
    effect: { str: SET_PRIMARY_3PC, sta: SET_PRIMARY_3PC },
    text: 'Increases Strength by 6 and Stamina by 6.',
  },
  {
    pieces: 4,
    effect: {
      proc: {
        id: 'set_gravemight',
        name: 'Gravemight',
        trigger: 'weaponCrit',
        chance: 0.5,
        aura: 'buff_ap',
        value: 60,
        duration: 10,
        icd: 15,
      },
    },
    text: 'Your weapon critical strikes have a 50% chance to grant Gravemight, increasing attack power by 60 for 10 sec.',
  },
];
const AGILITY_T1_BONUSES: SetBonusTier[] = [
  { pieces: 2, effect: { agi: SET_AGI_2PC }, text: 'Increases Agility by 8.' },
  {
    pieces: 3,
    effect: { agi: SET_PRIMARY_3PC, critRating: SET_CRIT_3PC_RATING },
    text: 'Increases Agility by 6 and critical strike chance by 1%.',
  },
  {
    pieces: 4,
    effect: {
      proc: {
        id: 'set_fangrush',
        name: 'Fangrush',
        trigger: 'weaponCrit',
        chance: 0.5,
        // buff_haste value is a swing-interval divisor (1.25 = 25% faster swings)
        aura: 'buff_haste',
        value: 1.25,
        duration: 8,
        icd: 15,
      },
    },
    text: 'Your weapon critical strikes have a 50% chance to grant Fangrush, increasing attack speed by 25% for 8 sec.',
  },
];
const CASTER_T1_BONUSES: SetBonusTier[] = [
  {
    pieces: 2,
    effect: { castPushbackReduction: 1, int: SET_INT_2PC },
    text: 'Increases Intellect by 6. Damage taken no longer delays your spellcasting (100% pushback resistance).',
  },
  {
    pieces: 3,
    effect: { int: SET_PRIMARY_3PC, sta: SET_PRIMARY_3PC },
    text: 'Increases Intellect by 6 and Stamina by 6.',
  },
  {
    pieces: 4,
    effect: {
      proc: {
        id: 'set_clearcasting',
        name: 'Clearcasting',
        trigger: 'spellCast',
        chance: 0.1,
        aura: 'next_cast_free',
        duration: 12,
        icd: 4,
      },
    },
    text: 'Your spells have a 10% chance to grant Clearcasting, making your next spell free.',
  },
];
// Tier-2 3-piece tiers carry the tier-1 stats PLUS haste.
const STRENGTH_T2_BONUSES: SetBonusTier[] = [
  { pieces: 2, effect: { str: SET_STR_2PC }, text: 'Increases Strength by 6.' },
  {
    pieces: 3,
    effect: { str: SET_PRIMARY_3PC, sta: SET_PRIMARY_3PC, hasteRating: SET_HASTE_3PC_RATING },
    text: 'Increases Strength by 6, Stamina by 6, and attack and casting speed by 2%.',
  },
  {
    pieces: 4,
    effect: {
      hitRating: SET_HIT_4PC_RATING,
      // Every weapon crit applies/stacks the bleed (no roll, no icd): with a
      // sustained crit every 8 to 12s the bleed sits at 1 to 2 stacks, peaking
      // at 3 (24 damage per 2s), roughly the 2-piece's flat 40 AP in
      // sustained damage while rewarding crit stacking. The added Hit rating is
      // what makes the set worth completing for Heroic content.
      proc: {
        id: 'set_bonesplinter',
        name: 'Bonesplinter',
        trigger: 'weaponCrit',
        chance: 1,
        applyTo: 'target',
        aura: 'dot',
        value: 8, // per tick, per stack
        tickInterval: 2,
        duration: 12,
        maxStacks: 3,
        school: 'physical',
      },
    },
    text: 'Increases Hit by 2.5%. Your weapon critical strikes splinter the target with Bonesplinter, bleeding it for 8 damage every 2 sec for 12 sec. Stacks up to 3 times.',
  },
];
const AGILITY_T2_BONUSES: SetBonusTier[] = [
  { pieces: 2, effect: { agi: SET_AGI_2PC }, text: 'Increases Agility by 8.' },
  {
    pieces: 3,
    effect: {
      agi: SET_PRIMARY_3PC,
      critRating: SET_CRIT_3PC_RATING,
      hasteRating: SET_HASTE_3PC_RATING,
    },
    text: 'Increases Agility by 6, critical strike chance by 1%, and attack and casting speed by 2%.',
  },
  {
    pieces: 4,
    effect: {
      hitRating: SET_HIT_4PC_RATING,
      // Leather crits land more often (the 3-piece adds crit AND haste), so
      // its bleed ticks lighter than the plate one: more applications, same
      // sustained value, peaking at 18 damage per 2s at 3 stacks. The added Hit
      // rating is what makes the set worth completing for Heroic content.
      proc: {
        id: 'set_ragged_gash',
        name: 'Ragged Gash',
        trigger: 'weaponCrit',
        chance: 1,
        applyTo: 'target',
        aura: 'dot',
        value: 6, // per tick, per stack
        tickInterval: 2,
        duration: 12,
        maxStacks: 3,
        school: 'physical',
      },
    },
    text: 'Increases Hit by 2.5%. Your weapon critical strikes tear a Ragged Gash, bleeding the target for 6 damage every 2 sec for 12 sec. Stacks up to 3 times.',
  },
];
const CASTER_T2_BONUSES: SetBonusTier[] = [
  {
    pieces: 2,
    effect: { castPushbackReduction: 1, int: SET_INT_2PC },
    text: 'Increases Intellect by 6. Damage taken no longer delays your spellcasting (100% pushback resistance).',
  },
  {
    pieces: 3,
    effect: { int: SET_PRIMARY_3PC, spi: SET_PRIMARY_3PC, hasteRating: SET_HASTE_3PC_RATING },
    text: 'Increases Intellect by 6, Spirit by 6, and attack and casting speed by 2%.',
  },
  {
    pieces: 4,
    effect: {
      proc: {
        id: 'set_soulblaze',
        name: 'Soulblaze',
        trigger: 'spellCast',
        chance: 0.1,
        aura: 'buff_spellpower',
        value: 40,
        duration: 10,
        icd: 20,
      },
    },
    text: 'Your spells have a 10% chance to grant Soulblaze, increasing spell power by 40 for 10 sec.',
  },
];
// The leveling haste kits grant haste alone, and only at 3 pieces:
// deliberately a single-tier reward a leveler assembles from world drops. They
// pay SET_HASTE_KIT_RATING, a tier UNDER the raid sets, because their members are
// level-1 items (Vale Arcanist's robe and Greyjaw's jerkin are q_ringleader
// starter quest rewards; the trail leggings are a 10% boar drop). See the
// constant for what paying them the raid number did to the haste ladder.
const HASTE_KIT_BONUSES: SetBonusTier[] = [
  {
    pieces: 3,
    effect: { hasteRating: SET_HASTE_KIT_RATING },
    text: 'Increases attack and casting speed by 1%.',
  },
];

// The four WARFARE capstone signatures (five families, because the two caster
// families share Emberward). All are pvpOnly, so combat/set_procs.ts
// refuses them (before the chance roll, so they draw no rng) outside hostile
// player-versus-player combat and they are inert in PvE by construction.
const WARFARE_UNBROKEN_OATH: SetProc = {
  id: 'set_warfare_unbroken_oath',
  name: 'Unbroken Oath',
  trigger: 'kill',
  chance: 1,
  aura: 'absorb',
  value: WARFARE_KILL_ABSORB,
  duration: WARFARE_KILL_ABSORB_DURATION,
  pvpOnly: true,
};
const WARFARE_ASHEN_STEP: SetProc = {
  id: 'set_warfare_ashen_step',
  name: 'Ashen Step',
  trigger: 'kill',
  chance: 1,
  aura: 'buff_speed',
  value: WARFARE_KILL_SPEED_MULT,
  duration: WARFARE_KILL_SPEED_DURATION,
  pvpOnly: true,
};
const WARFARE_THORNGUARD: SetProc = {
  id: 'set_warfare_thornguard',
  name: 'Thornguard',
  trigger: 'spellCast',
  chance: WARFARE_CAST_DODGE_CHANCE,
  aura: 'buff_dodge',
  value: WARFARE_CAST_DODGE,
  duration: WARFARE_CAST_DODGE_DURATION,
  icd: WARFARE_CAST_DODGE_ICD,
  pvpOnly: true,
};
const WARFARE_EMBERWARD: SetProc = {
  id: 'set_warfare_emberward',
  name: 'Emberward',
  trigger: 'spellCast',
  chance: WARFARE_CAST_ABSORB_CHANCE,
  aura: 'absorb',
  value: WARFARE_CAST_ABSORB,
  duration: WARFARE_CAST_ABSORB_DURATION,
  icd: WARFARE_CAST_ABSORB_ICD,
  pvpOnly: true,
};

// The 2- and 4-piece tiers are identical across all five families; only the
// capstone signature differs. The 4-piece wording says crowd control "cast on
// you by hostile players" rather than "from hostile players" on purpose: control
// applied by a player's PET is entity kind 'mob' and takes the non-hostile-pair
// early return in Sim.diminishedCrowdControlDuration, so it is not reduced and
// the looser wording would be false.
function warfareBonuses(signature: SetProc, capstoneText: string): SetBonusTier[] {
  return [
    {
      pieces: 2,
      effect: { pvpDefenseRating: WARFARE_SET_2PC_DEFENSE_RATING },
      text: 'Increases Warfare Defense Rating by 40.',
    },
    {
      pieces: 4,
      effect: {
        pvpOffenseRating: WARFARE_SET_4PC_OFFENSE_RATING,
        ccDurationReduction: WARFARE_SET_4PC_CC_REDUCTION,
      },
      text: 'Increases Warfare Offense Rating by 40, and crowd control cast on you by hostile players lasts 15% less.',
    },
    {
      pieces: 7,
      effect: {
        pvpOffenseRating: WARFARE_SET_7PC_RATING,
        pvpDefenseRating: WARFARE_SET_7PC_RATING,
        proc: signature,
      },
      text: capstoneText,
    },
  ];
}

export const ITEM_SETS: Record<string, ItemSet> = {
  [SET_DEATHLORD]: {
    id: SET_DEATHLORD,
    name: 'Barrowlord Battlegear',
    bonuses: STRENGTH_T1_BONUSES,
  },
  [SET_WYRMSHADOW]: {
    id: SET_WYRMSHADOW,
    name: 'Nightfang Vestments',
    bonuses: AGILITY_T1_BONUSES,
  },
  [SET_NECROMANCERS]: {
    id: SET_NECROMANCERS,
    name: 'Mournweave Raiment',
    bonuses: CASTER_T1_BONUSES,
  },
  [SET_CROWNFORGED]: {
    id: SET_CROWNFORGED,
    name: 'Bonewrought Regalia',
    bonuses: STRENGTH_T2_BONUSES,
  },
  [SET_NIGHTTALON]: { id: SET_NIGHTTALON, name: 'Direfang Pelt', bonuses: AGILITY_T2_BONUSES },
  [SET_SOULFLAME]: { id: SET_SOULFLAME, name: 'Wraithfire Regalia', bonuses: CASTER_T2_BONUSES },
  [SET_STORMCALLERS]: {
    id: SET_STORMCALLERS,
    name: 'Galecall Vestments',
    bonuses: CASTER_T2_BONUSES,
  },
  [SET_VALE_ARCANIST]: {
    id: SET_VALE_ARCANIST,
    name: "Vale Arcanist's Regalia",
    bonuses: HASTE_KIT_BONUSES,
  },
  [SET_BOUNDSTONE_VANGUARD]: {
    id: SET_BOUNDSTONE_VANGUARD,
    name: 'Boundstone Vanguard',
    bonuses: HASTE_KIT_BONUSES,
  },
  [SET_GREYJAW_STALKER]: {
    id: SET_GREYJAW_STALKER,
    name: "Greyjaw Stalker's Kit",
    bonuses: HASTE_KIT_BONUSES,
  },
  [SET_WARFARE_FURYFORGED]: {
    id: SET_WARFARE_FURYFORGED,
    name: 'Furyforged Battlegear',
    bonuses: warfareBonuses(
      WARFARE_UNBROKEN_OATH,
      'Increases Warfare Offense and Defense Rating by 80. Killing a hostile player grants Unbroken Oath, absorbing 200 damage for 10 sec.',
    ),
  },
  [SET_WARFARE_STORMBOUND]: {
    id: SET_WARFARE_STORMBOUND,
    name: 'Stormbound Vestments',
    bonuses: warfareBonuses(
      WARFARE_EMBERWARD,
      'Increases Warfare Offense and Defense Rating by 80. Your spells have a 15% chance to grant Emberward, absorbing 120 damage for 8 sec.',
    ),
  },
  [SET_WARFARE_ASHSTALKER]: {
    id: SET_WARFARE_ASHSTALKER,
    name: 'Ashstalker Kit',
    bonuses: warfareBonuses(
      WARFARE_ASHEN_STEP,
      'Increases Warfare Offense and Defense Rating by 80. Killing a hostile player grants Ashen Step, increasing movement speed by 40% for 6 sec.',
    ),
  },
  [SET_WARFARE_CINDERWEAVE]: {
    id: SET_WARFARE_CINDERWEAVE,
    name: 'Cinderweave Regalia',
    bonuses: warfareBonuses(
      WARFARE_EMBERWARD,
      'Increases Warfare Offense and Defense Rating by 80. Your spells have a 15% chance to grant Emberward, absorbing 120 damage for 8 sec.',
    ),
  },
  [SET_WARFARE_THORNHIDE]: {
    id: SET_WARFARE_THORNHIDE,
    name: 'Thornhide Garb',
    bonuses: warfareBonuses(
      WARFARE_THORNGUARD,
      'Increases Warfare Offense and Defense Rating by 80. Your spells have a 15% chance to grant Thornguard, increasing dodge by 15% for 6 sec.',
    ),
  },
};

// Fully-resolved set effect: every field defaulted so callers never branch on
// undefined. `castPushbackReduction` and `knockbackResistance` are clamped to 0..1.
export interface AggregatedSetEffect {
  str: number;
  agi: number;
  sta: number;
  int: number;
  spi: number;
  ap: number;
  sp: number;
  crit: number;
  critRating: number;
  haste: number;
  hasteRating: number;
  hitRating: number;
  castPushbackReduction: number;
  knockbackResistance: number;
  pvpOffenseRating: number;
  pvpDefenseRating: number;
  ccDurationReduction: number;
  procs: SetProc[];
}

function zeroEffect(): AggregatedSetEffect {
  return {
    str: 0,
    agi: 0,
    sta: 0,
    int: 0,
    spi: 0,
    ap: 0,
    sp: 0,
    crit: 0,
    critRating: 0,
    haste: 0,
    hasteRating: 0,
    hitRating: 0,
    castPushbackReduction: 0,
    knockbackResistance: 0,
    pvpOffenseRating: 0,
    pvpDefenseRating: 0,
    ccDurationReduction: 0,
    procs: [],
  };
}

// Resolve equipped set-piece counts (setId -> count) into the summed bonus.
// Stat/AP/crit effects and the WARFARE ratings add across every met tier;
// pushback, knockback and crowd-control-duration resistance max-combine rather
// than summing past 1. Pure and host-agnostic so a Vitest can drive it directly.
export function aggregateSetBonuses(counts: Map<string, number>): AggregatedSetEffect {
  const out = zeroEffect();
  for (const [setId, count] of counts) {
    const set = ITEM_SETS[setId];
    if (!set) continue;
    for (const tier of set.bonuses) {
      if (count < tier.pieces) continue;
      const e: SetBonusEffect = tier.effect;
      out.str += e.str ?? 0;
      out.agi += e.agi ?? 0;
      out.sta += e.sta ?? 0;
      out.int += e.int ?? 0;
      out.spi += e.spi ?? 0;
      out.ap += e.ap ?? 0;
      out.sp += e.sp ?? 0;
      out.crit += e.crit ?? 0;
      out.critRating += e.critRating ?? 0;
      out.haste += e.haste ?? 0;
      out.hasteRating += e.hasteRating ?? 0;
      out.hitRating += e.hitRating ?? 0;
      // WARFARE ratings SUM across met tiers, like critRating and hasteRating.
      // The cap is applied once, downstream, on the combined gear-plus-set total.
      out.pvpOffenseRating += e.pvpOffenseRating ?? 0;
      out.pvpDefenseRating += e.pvpDefenseRating ?? 0;
      // Crowd-control reduction MAX-combines rather than summing, following
      // castPushbackReduction and knockbackResistance below: two sources must
      // never stack into immunity.
      if (e.ccDurationReduction != null) {
        out.ccDurationReduction = Math.max(out.ccDurationReduction, e.ccDurationReduction);
      }
      if (e.castPushbackReduction != null) {
        out.castPushbackReduction = Math.max(out.castPushbackReduction, e.castPushbackReduction);
      }
      if (e.knockbackResistance != null) {
        out.knockbackResistance = Math.max(out.knockbackResistance, e.knockbackResistance);
      }
      if (e.proc) out.procs.push(e.proc);
    }
  }
  out.castPushbackReduction = Math.min(1, Math.max(0, out.castPushbackReduction));
  out.knockbackResistance = Math.min(1, Math.max(0, out.knockbackResistance));
  out.ccDurationReduction = Math.min(1, Math.max(0, out.ccDurationReduction));
  return out;
}
