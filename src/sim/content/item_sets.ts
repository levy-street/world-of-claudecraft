// Item sets and their equipped-piece bonuses (classic "tier set" style).
//
// The sets are the epic armor families that drop from the Gravewyrm Sanctum
// (tier 1) and the Nythraxis raid (tier 2), plus three leveling "haste kit"
// families assembled from existing world-drop items.
//
// THE LINEAGE LADDER (the incumbent retune, docs/prd/ignivar-raid-loot.md):
// each archetype's tier-1 and tier-2 families count as ONE lineage with
// breakpoints at 2, 4, and 6 pieces worn ACROSS the lineage: deathlord plus
// crownforged (Strength), wyrmshadow plus nighttalon (Agility), and
// necromancers plus soulflame plus stormcallers (caster; the two tier-2 caster
// families share slots so they can never be worn together). Every lineage
// unions to exactly seven wearable slots with one overlap, so six pieces is a
// real commitment (the WARFARE 2/4/7 shape applied to the PvE incumbents).
// Member families SHARE one bonuses array (the lineage table) and carry a
// `lineage` tag; `aggregateSetBonuses` sums worn counts across the lineage and
// applies the shared table exactly once. Tiers stack as before, and the tier-1
// procs live at the 4-piece tier while the tier-2 procs are the 6-piece
// capstones, so no named effect was deleted in the retune.
//
// The five WARFARE honor families the quartermasters sell (content/pvp_honor.ts)
// break at 2, 4 and 7 pieces of one seven-piece family, and are paid entirely
// in WARFARE rating and PvP-gated effects rather than in stats, so they
// contribute exactly zero in PvE. See the WARFARE block below and
// docs/design/warfare.md. The leveling haste kits keep their single 3-piece
// tier. This file is data-as-code: balance numbers live here, never inline in
// the engine. `aggregateSetBonuses` is the pure resolver imported by
// `entity.ts`.

import type { ItemSet, SetBonusEffect, SetBonusTier, SetProc } from '../types';

// Haste granted by a set tier after the global combat-rating conversion: what
// SET_HASTE_3PC_RATING is worth once recalcPlayerStats converts it. Read only
// by the tests, deliberately as a literal so it pins the conversion
// independently; it must be updated by hand whenever HASTE_RATING_PER_PCT moves.
// (The name keeps its historic 3PC suffix: the haste leveling kits still grant
// it at 3 pieces, while the epic lineages now grant it at their 6-piece
// capstone; see the retune in docs/prd/ignivar-raid-loot.md.)
export const SET_HASTE_3PC = 0.04;
export const SET_HASTE_3PC_RATING = 80; // -> 4% haste at 20 rating = 1%
export const SET_CRIT_3PC_RATING = 20; // -> +1% crit at 20 rating = 1%
// The lineage capstone bleeds (Bonesplinter, Ragged Gash) are modest on their
// own; the capstone also grants Hit rating so finishing six pieces is worth
// chasing for Heroic (+3 above-level) content. Halved in the same retune.
export const SET_HIT_4PC_RATING = 30; // -> +3% hit at 10 rating = 1%

// The WARFARE honor sets (content/pvp_honor.ts). Every tier is paid in WARFARE
// rating or in a PvP-gated effect and never in flat stats, which is what makes
// "honor gear is never better than raid gear in a raid" structural rather than a
// tuning argument: the whole set contributes exactly zero in PvE.
// Breakpoints are 2, 4 and 7 of the seven armor pieces. Seven, not six: with the
// capstone at six the seventh armor slot had one right answer, which was to
// abandon the chest (the most expensive piece with the best PvE replacement) and
// the cheaper hybrid build beat the full kit outright. Measured against a
// tier-1-plus-tier-2 reference warrior: 6 armor pieces plus a raid chest, a raid
// weapon and badge jewelry cost 4,200 honor and landed 0.89x, against 5,400 honor
// and 1.03x for the full kit, so the cheaper build won. At 7 of 7 the same build
// forfeits both the 22-rating chest AND the 80/80 capstone and lands clearly
// worse, which is what a non-choice should look like.
// tests/warfare_balance_harness.test.ts re-measures this against the shipped
// numbers and is the guard that keeps it true.
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

// Lineage ids: the cross-tier archetype ladders (see the header). The id is
// carried on each member ItemSet's `lineage` field.
export const LINEAGE_STRENGTH = 'strength_lineage';
export const LINEAGE_AGILITY = 'agility_lineage';
export const LINEAGE_CASTER = 'caster_lineage';

// Lineage bonus tiers, at 2, 4, and 6 pieces worn across the lineage. Tiers
// stack (six pieces grant all three tiers); cast pushback reduction and
// knockback resistance max-combine (see the resolver). Values are the retuned
// (roughly halved) magnitudes from docs/prd/ignivar-raid-loot.md: the summed
// old double-stack paid two near-full packages, and the ladder replaces that
// with one sized package whose top requires six pieces.
const STRENGTH_LINEAGE_BONUSES: SetBonusTier[] = [
  {
    pieces: 2,
    effect: { str: 10, sta: 10 },
    text: 'Increases Strength by 10 and Stamina by 10.',
  },
  {
    pieces: 4,
    effect: {
      ap: 25,
      proc: {
        id: 'set_gravemight',
        name: 'Gravemight',
        trigger: 'weaponCrit',
        chance: 0.5,
        aura: 'buff_ap',
        value: 40,
        duration: 10,
        icd: 15,
      },
    },
    text: 'Increases attack power by 25. Your weapon critical strikes have a 50% chance to grant Gravemight, increasing attack power by 40 for 10 sec.',
  },
  {
    pieces: 6,
    effect: {
      hasteRating: SET_HASTE_3PC_RATING,
      hitRating: SET_HIT_4PC_RATING,
      // Every weapon crit applies/stacks the bleed (no roll, no icd): with a
      // sustained crit every 8 to 12s the bleed sits at 1 to 2 stacks, peaking
      // at 15 damage per 2s.
      proc: {
        id: 'set_bonesplinter',
        name: 'Bonesplinter',
        trigger: 'weaponCrit',
        chance: 1,
        applyTo: 'target',
        aura: 'dot',
        value: 5, // per tick, per stack
        tickInterval: 2,
        duration: 12,
        maxStacks: 3,
        school: 'physical',
      },
    },
    text: 'Increases attack and casting speed by 4% and Hit by 3%. Your weapon critical strikes splinter the target with Bonesplinter, bleeding it for 5 damage every 2 sec for 12 sec. Stacks up to 3 times.',
  },
];
const AGILITY_LINEAGE_BONUSES: SetBonusTier[] = [
  {
    pieces: 2,
    effect: { agi: 10, critRating: SET_CRIT_3PC_RATING },
    text: 'Increases Agility by 10 and critical strike chance by 1%.',
  },
  {
    pieces: 4,
    effect: {
      ap: 25,
      proc: {
        id: 'set_fangrush',
        name: 'Fangrush',
        trigger: 'weaponCrit',
        chance: 0.5,
        // buff_haste value is a swing-interval divisor (1.15 = 15% faster swings)
        aura: 'buff_haste',
        value: 1.15,
        duration: 8,
        icd: 15,
      },
    },
    text: 'Increases attack power by 25. Your weapon critical strikes have a 50% chance to grant Fangrush, increasing attack speed by 15% for 8 sec.',
  },
  {
    pieces: 6,
    effect: {
      hasteRating: SET_HASTE_3PC_RATING,
      hitRating: SET_HIT_4PC_RATING,
      // Agility crits land more often (the 2-piece adds crit), so its bleed
      // ticks lighter than the Strength one: more applications, same sustained
      // value, peaking at 12 damage per 2s at 3 stacks.
      proc: {
        id: 'set_ragged_gash',
        name: 'Ragged Gash',
        trigger: 'weaponCrit',
        chance: 1,
        applyTo: 'target',
        aura: 'dot',
        value: 4, // per tick, per stack
        tickInterval: 2,
        duration: 12,
        maxStacks: 3,
        school: 'physical',
      },
    },
    text: 'Increases attack and casting speed by 4% and Hit by 3%. Your weapon critical strikes tear a Ragged Gash, bleeding the target for 4 damage every 2 sec for 12 sec. Stacks up to 3 times.',
  },
];
const CASTER_LINEAGE_BONUSES: SetBonusTier[] = [
  {
    pieces: 2,
    // Half pushback resistance: full immunity moved to the new raid tier's
    // caster and healer 2-piece bonuses in the same retune.
    effect: { int: 10, spi: 10, castPushbackReduction: 0.5 },
    text: 'Increases Intellect by 10 and Spirit by 10. Damage taken delays your spellcasting half as much (50% pushback resistance).',
  },
  {
    pieces: 4,
    effect: {
      sp: 12,
      proc: {
        id: 'set_clearcasting',
        name: 'Clearcasting',
        trigger: 'spellCast',
        chance: 0.06,
        aura: 'next_cast_free',
        duration: 12,
        icd: 4,
      },
    },
    text: 'Increases spell power by 12. Your spells have a 6% chance to grant Clearcasting, making your next spell free.',
  },
  {
    pieces: 6,
    effect: {
      hasteRating: SET_HASTE_3PC_RATING,
      proc: {
        id: 'set_soulblaze',
        name: 'Soulblaze',
        trigger: 'spellCast',
        chance: 0.1,
        aura: 'buff_spellpower',
        value: 25,
        duration: 10,
        icd: 20,
      },
    },
    text: 'Increases attack and casting speed by 4%. Your spells have a 10% chance to grant Soulblaze, increasing spell power by 25 for 10 sec.',
  },
];
// The leveling haste kits grant haste alone, and only at 3 pieces:
// deliberately a single-tier reward a leveler assembles from world drops.
const HASTE_KIT_BONUSES: SetBonusTier[] = [
  {
    pieces: 3,
    effect: { hasteRating: SET_HASTE_3PC_RATING },
    text: 'Increases attack and casting speed by 7.5%.',
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
    lineage: LINEAGE_STRENGTH,
    bonuses: STRENGTH_LINEAGE_BONUSES,
  },
  [SET_WYRMSHADOW]: {
    id: SET_WYRMSHADOW,
    name: 'Nightfang Vestments',
    lineage: LINEAGE_AGILITY,
    bonuses: AGILITY_LINEAGE_BONUSES,
  },
  [SET_NECROMANCERS]: {
    id: SET_NECROMANCERS,
    name: 'Mournweave Raiment',
    lineage: LINEAGE_CASTER,
    bonuses: CASTER_LINEAGE_BONUSES,
  },
  [SET_CROWNFORGED]: {
    id: SET_CROWNFORGED,
    name: 'Bonewrought Regalia',
    lineage: LINEAGE_STRENGTH,
    bonuses: STRENGTH_LINEAGE_BONUSES,
  },
  [SET_NIGHTTALON]: {
    id: SET_NIGHTTALON,
    name: 'Direfang Pelt',
    lineage: LINEAGE_AGILITY,
    bonuses: AGILITY_LINEAGE_BONUSES,
  },
  [SET_SOULFLAME]: {
    id: SET_SOULFLAME,
    name: 'Wraithfire Regalia',
    lineage: LINEAGE_CASTER,
    bonuses: CASTER_LINEAGE_BONUSES,
  },
  [SET_STORMCALLERS]: {
    id: SET_STORMCALLERS,
    name: 'Galecall Vestments',
    lineage: LINEAGE_CASTER,
    bonuses: CASTER_LINEAGE_BONUSES,
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

  // ---- Crucible tier sets (Ignivar raid, Phase B) ----
  // Five-piece class sets breaking at 2 and 4 pieces. The tiers here carry
  // EMPTY stat effects ON PURPOSE: every Crucible bonus modifies the spec's
  // engine, never raw stats (the maintainer ruling in
  // docs/prd/ignivar-raid-loot.md, decision 7), so the payloads live in
  // content/ignivar_set_bonuses.ts and apply through the talent-modifier
  // seam (src/sim/set_bonus_mods.ts). The `text` below is the tooltip
  // promise; tests pin it against the audited engine constants so copy and
  // implementation cannot drift. Sets register one class wave at a time,
  // text and engine TOGETHER (the rollout ledger in
  // tests/ignivar_loot.test.ts), so a tooltip never promises an
  // unimplemented bonus.
  slagbreaker: {
    id: 'slagbreaker',
    name: 'Slagbreaker Battlegear',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: 'Redhand empowers your next Maiming Strike by 30 percent per stack instead of 20.',
      },
      {
        pieces: 4,
        effect: {},
        // "Every second cast", not "casting": the engine fires on castNth
        // n:2 (the adversarial-round sizing), and the tooltip must not
        // promise double the real rate. Deviation from the set doc's copy
        // line, flagged for maintainer review in the PR.
        text: "Every second cast of Redhand reduces Breachmaker's remaining cooldown by 3 sec.",
      },
    ],
  },
  emberfury: {
    id: 'emberfury',
    name: 'Emberfury Harness',
    bonuses: [
      { pieces: 2, effect: {}, text: 'Your Enrage lasts 6 sec instead of 4.' },
      {
        pieces: 4,
        effect: {},
        text: 'Bloodletting always Enrages you, and its healing rises to 8 percent of your maximum health.',
      },
    ],
  },
  forgewall: {
    id: 'forgewall',
    name: 'Forgewall Aegis',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: 'Iron Resolve converts rage at 5 absorb per point instead of 4.',
      },
      {
        pieces: 4,
        effect: {},
        text: "Casting Shieldcrack reduces Iron Resolve's remaining cooldown by 2 sec.",
      },
    ],
  },
  dawnforged: {
    id: 'dawnforged',
    name: 'Dawnforged Vestments',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        // The healer 2pc carries the pushback rider (full immunity, the raid
        // tier's upgrade over the leveling lineage's 50 percent).
        text: 'Beacon of Light copies 55 percent of your direct heals. Damage taken no longer delays your spellcasting.',
      },
      {
        pieces: 4,
        effect: {},
        text: "Radiant Resonance's empowered Dawn's Embrace is instant.",
      },
    ],
  },
  oathpyre: {
    id: 'oathpyre',
    name: 'Oathpyre Bastion',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: "Vowkeeper Strike's chance to arm Solar Reprisal rises to 30 percent, and blocking an attack arms it 40 percent of the time.",
      },
      {
        pieces: 4,
        effect: {},
        text: 'Consuming Solar Reprisal shields you for 6 percent of your maximum health for 10 sec.',
      },
    ],
  },
  zealfire: {
    id: 'zealfire',
    name: 'Zealfire Warplate',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: "Final Edict and Dawnfall cut each other's remaining cooldown by 3 sec instead of 2.",
      },
      {
        pieces: 4,
        effect: {},
        text: "Hammer of Wrath cast under Dawn's Wrath strikes 40 percent harder, up from 20.",
      },
    ],
  },
  packlord_emberhide: {
    id: 'packlord_emberhide',
    name: "Packlord's Emberhide",
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: "Pack Command's cooldown is reduced to 3 sec.",
      },
      {
        pieces: 4,
        effect: {},
        text: "Pack Command's chance to reset Stampede's cooldown rises to 30 percent.",
      },
    ],
  },
  coldsight_trackers: {
    id: 'coldsight_trackers',
    name: 'Coldsight Trackers',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: 'Measured Shot restores 5 additional Focus.',
      },
      {
        pieces: 4,
        effect: {},
        // "per activation", not the set doc's "per window": the sim-purity
        // scanner (tests/architecture.test.ts DOM_GLOBAL_RE) rejects the
        // literal token "window." anywhere under src/sim, prose included.
        // Same meaning, flagged as a copy deviation in the PR.
        text: 'Long Draw critical strikes extend Cold Focus by 2 sec, up to 6 sec per activation.',
      },
    ],
  },
  slagsnare: {
    id: 'slagsnare',
    name: 'Slagsnare Trappings',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: 'Gutting Strike generates 20 Focus.',
      },
      {
        pieces: 4,
        effect: {},
        text: 'Woundrend that consumes 3 Hunting Momentum preserves them. Cannot occur more than once every 8 sec.',
      },
    ],
  },
  cinderfang: {
    id: 'cinderfang',
    name: 'Cinderfang Shroud',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: "Venom Ritual's energy refund rises to 20 per builder.",
      },
      {
        pieces: 4,
        effect: {},
        text: "Venom Dart's cooldown is reduced to 4 sec.",
      },
    ],
  },
  smolderstrike: {
    id: 'smolderstrike',
    name: 'Smolderstrike Leathers',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: 'Haymaker hits 20 percent harder.',
      },
      {
        pieces: 4,
        effect: {},
        text: "Lights Out refunds 6 sec of Mirrored Blades' remaining cooldown.",
      },
    ],
  },
  ashveil: {
    id: 'ashveil',
    name: 'Ashveil Garb',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: "Lurker's Strike hits 25 percent harder.",
      },
      {
        pieces: 4,
        effect: {},
        text: 'Your Veiled Edge strike hits for triple, up from double.',
      },
    ],
  },
  emberscreed: {
    id: 'emberscreed',
    name: 'Creed of Embers Vestments',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        // The healer/caster 2pc carries the pushback rider (full immunity,
        // the raid tier's upgrade over the leveling lineage's 50 percent).
        text: 'Your Doctrine link converts 10 percent more of your Holy damage into healing. Damage taken no longer delays your spellcasting.',
      },
      {
        pieces: 4,
        effect: {},
        text: 'When your Psalm of Warding is fully consumed, your next Scouring Hymn within 10 sec is instant. Cannot occur more than once every 15 sec.',
      },
    ],
  },
  benison_dawnweave: {
    id: 'benison_dawnweave',
    name: 'Benison Dawnweave',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: "Seraphic Vigil's rescue heals for 270, up from 180. Damage taken no longer delays your spellcasting.",
      },
      {
        pieces: 4,
        effect: {},
        text: 'When Seraphic Vigil triggers, its ally is also mended for 15 percent of their maximum health over 10 sec.',
      },
    ],
  },
  vesperash: {
    id: 'vesperash',
    name: 'Vesperash Shroud',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: "Call Tithefiend's cooldown is reduced by 6 sec. Damage taken no longer delays your spellcasting.",
      },
      {
        pieces: 4,
        effect: {},
        text: "Calling your Tithefiend resets Mindfracture's cooldown, and the fiend returns twice as much mana per hit.",
      },
    ],
  },
  stormkindled: {
    id: 'stormkindled',
    name: 'Stormkindled Regalia',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        // The caster 2pc carries the pushback rider (full immunity, the raid
        // tier's upgrade over the leveling lineage's 50 percent).
        text: 'Unleash Weapon on Pyrebrand grants 3 Thunder. Damage taken no longer delays your spellcasting.',
      },
      {
        pieces: 4,
        effect: {},
        text: "Earthen Jolt's bonus per Thunder rises to 30 percent.",
      },
    ],
  },
  warspirit_emberscale: {
    id: 'warspirit_emberscale',
    name: 'Warspirit Emberscale',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: 'Ancestral Strike advances your cadence 3 steps.',
      },
      {
        pieces: 4,
        effect: {},
        text: 'Ancestral Strike hits 30 percent harder.',
      },
    ],
  },
  stonehearth: {
    id: 'stonehearth',
    name: 'Stonehearth Bastion',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: 'While Stonebound, Stormcast Mending Waters costs no mana and heals 25 percent more.',
      },
      {
        pieces: 4,
        effect: {},
        text: 'While Stonebound, completing a cadence heals you for 3 percent of your maximum health.',
      },
    ],
  },
  springmender: {
    id: 'springmender',
    name: 'Springmender Scale',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: "Tidecall's cooldown is reduced by 4 sec. Damage taken no longer delays your spellcasting.",
      },
      {
        pieces: 4,
        effect: {},
        text: 'Cascading Mend reaches a fourth ally and harvests Mending Currents at 150 percent.',
      },
    ],
  },
  chronoweave: {
    id: 'chronoweave',
    // Renamed from the working title "Chronoweave" in the final adversarial
    // round: the old name collided with the arcane mastery. The set ID stays
    // `chronoweave` (the shipped Phase A item tags carry it).
    name: 'Aetherweave Vestments',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        // The healer 2pc carries the pushback rider (full immunity, the raid
        // tier's upgrade over the leveling lineage's 50 percent).
        text: 'Temporal Echo converts 50 percent of your single-target Arcane damage into healing. Damage taken no longer delays your spellcasting.',
      },
      {
        pieces: 4,
        effect: {},
        text: "Temporal Cascade's cooldown is reduced by 5 sec.",
      },
    ],
  },
  pyroclast: {
    id: 'pyroclast',
    name: 'Pyroclast Regalia',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: 'Scald always critically strikes targets at or below 35 percent health. Damage taken no longer delays your spellcasting.',
      },
      {
        pieces: 4,
        effect: {},
        text: "Your Fire spells' critical strikes outside Phoenix Trance reduce its remaining cooldown by 1.5 sec.",
      },
    ],
  },
  frostquench: {
    id: 'frostquench',
    name: 'Frostquench Weave',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: 'Rimelance critical strikes bank a second Icicle, up to the maximum of 5. Damage taken no longer delays your spellcasting.',
      },
      {
        pieces: 4,
        effect: {},
        text: "Winterlash plants 3 Winter's Chill charges, up from 2.",
      },
    ],
  },
  hexthread: {
    id: 'hexthread',
    name: 'Hexthread Shroud',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        // The caster 2pc carries the pushback rider (full immunity, the raid
        // tier's upgrade over the leveling lineage's 50 percent).
        text: 'Needle of Fate grants 2 additional Condemnation. Damage taken no longer delays your spellcasting.',
      },
      {
        pieces: 4,
        effect: {},
        text: 'Passing Sentence refunds 10 Condemnation.',
      },
    ],
  },
  gravebrand: {
    id: 'gravebrand',
    name: 'Gravebrand Regalia',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: "Reaping Command's cooldown is reduced by 2 sec. Damage taken no longer delays your spellcasting.",
      },
      {
        pieces: 4,
        effect: {},
        text: "Reaping Command's unison strikes deal 25 percent more damage.",
      },
    ],
  },
  ruincaller: {
    id: 'ruincaller',
    name: 'Ruincaller Vestments',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: 'Conflagrate holds 3 charges. Damage taken no longer delays your spellcasting.',
      },
      {
        pieces: 4,
        effect: {},
        text: 'Ruinbolt strikes 20 percent harder.',
      },
    ],
  },
  moonscorch: {
    id: 'moonscorch',
    name: 'Moonscorch Raiment',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        // The caster 2pc carries the pushback rider (full immunity, the raid
        // tier's upgrade over the leveling lineage's 50 percent).
        text: 'Moonseed may extend Lunar Tempest twice per application, to a maximum of 12 sec. Damage taken no longer delays your spellcasting.',
      },
      {
        pieces: 4,
        effect: {},
        text: 'Moonsurge and Sunwake strike 25 percent harder.',
      },
    ],
  },
  wildfang_emberhide: {
    id: 'wildfang_emberhide',
    name: 'Wildfang Emberhide',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: 'Redharvest restores 45 energy, up from 30.',
      },
      {
        pieces: 4,
        effect: {},
        text: 'Redharvest plants a fresh Flense on the target.',
      },
    ],
  },
  cinderbark: {
    id: 'cinderbark',
    name: 'Cinderbark Ward',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        text: 'Sweeping Claws has a 30 percent chance to bank an additional Old Blood.',
      },
      {
        pieces: 4,
        effect: {},
        text: 'Marrowbreak hits 30 percent harder, and its emergency guard no longer replaces the strike.',
      },
    ],
  },
  grovespring: {
    id: 'grovespring',
    name: 'Grovespring Raiment',
    bonuses: [
      {
        pieces: 2,
        effect: {},
        // "prefers your own ... first", not the set doc's "consumes only your
        // own": the implemented (and doc-mandated) explicit fallback still
        // consumes any HoT when the wearer has none of their own, so "only"
        // would overclaim the narrowing. Recorded as a copy deviation in the
        // wave's PR notes.
        text: 'Swiftmend consumes your own Wildbloom or Second Bloom first and heals 25 percent more. Damage taken no longer delays your spellcasting.',
      },
      {
        pieces: 4,
        effect: {},
        text: 'Overbloom harvests 75 percent of your remaining effects and banks 1 Verdance afterward.',
      },
    ],
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
  healPower: number;
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
    healPower: 0,
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
  // Fold family counts into lineage counts first, so tier thresholds read the
  // COMBINED tier-1 plus tier-2 pieces (the 2/4/6 ladder). Each lineage's
  // shared table applies exactly once, from whichever member set is seen
  // first; non-lineage families (WARFARE, haste kits) resolve per set.
  const lineageCounts = new Map<string, number>();
  for (const [setId, count] of counts) {
    const lineage = ITEM_SETS[setId]?.lineage;
    if (lineage !== undefined) {
      lineageCounts.set(lineage, (lineageCounts.get(lineage) ?? 0) + count);
    }
  }
  const appliedLineages = new Set<string>();
  for (const [setId, count] of counts) {
    const set = ITEM_SETS[setId];
    if (!set) continue;
    let effectiveCount = count;
    if (set.lineage !== undefined) {
      if (appliedLineages.has(set.lineage)) continue;
      appliedLineages.add(set.lineage);
      effectiveCount = lineageCounts.get(set.lineage) ?? count;
    }
    for (const tier of set.bonuses) {
      if (effectiveCount < tier.pieces) continue;
      const e: SetBonusEffect = tier.effect;
      out.str += e.str ?? 0;
      out.agi += e.agi ?? 0;
      out.sta += e.sta ?? 0;
      out.int += e.int ?? 0;
      out.spi += e.spi ?? 0;
      out.ap += e.ap ?? 0;
      out.sp += e.sp ?? 0;
      out.healPower += e.healPower ?? 0;
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
