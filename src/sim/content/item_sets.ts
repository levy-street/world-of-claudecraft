// Item sets and their equipped-piece bonuses (classic "tier set" style).
//
// The sets are the epic armor families that drop from the Gravewyrm Sanctum
// (tier 1) and the Nythraxis raid (tier 2), plus three leveling "haste kit"
// families assembled from existing world-drop items. Wearing enough pieces of
// a family grants stacking 2-, 3-, and 4-piece bonuses, resolved in
// `recalcPlayerStats` (primary stats, attack power, crit, haste, knockback
// resistance). Every epic family's 4-piece tier is a proc (see SetProc):
// weapon-crit-triggered for the plate and leather archetypes, spell-cast-
// triggered for the caster archetypes, resolved by combat/set_procs.ts.
//
// Bonuses are keyed by archetype: the plate (Strength) families get attack
// power then Strength/Stamina; the leather (Agility) families get attack power
// then Agility/crit; the cloth (caster) families get knockback resistance at 2
// pieces and Intellect plus Stamina for tier 1, or Intellect plus Spirit for
// tier 2, at 3 pieces. Every tier-2 3-piece bonus ALSO grants haste (ONE stat:
// faster melee and ranged swings AND shorter casts/channels), and the three
// leveling haste kits grant haste alone at 3 pieces. This file is
// data-as-code: balance numbers live here, never inline in the engine.
// `aggregateSetBonuses` is the pure resolver imported by `entity.ts`.

import type { ItemSet, SetBonusEffect, SetBonusTier, SetProc } from '../types';

// Haste granted by a 3-piece bonus (fraction). The one knob for every haste
// source: 0.15 makes swings 15% faster and casts/channels 15% shorter.
export const SET_HASTE_3PC = 0.15;
export const SET_HASTE_3PC_RATING = 150; // -> 15% haste at 10 rating = 1%
export const SET_CRIT_3PC_RATING = 20; // -> +2% crit at 10 rating = 1%
// The two T2 4-piece bleeds (Bonesplinter, Ragged Gash) are marginal on their own
// (roughly their 2-piece's flat 40 AP). They now also grant Hit rating so completing
// the set is worth chasing for Heroic (+3 above-level), where the bleed alone was not.
export const SET_HIT_4PC_RATING = 60; // -> +6% hit at 10 rating = 1%

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

// Archetype bonus tiers. Tiers stack (a 3-piece set grants both the 2- and
// 3-piece bonuses); cast pushback reduction and knockback resistance
// max-combine (see the resolver).
// Every family reaches its 3-piece tier: tier-1 pieces drop in the Gravewyrm
// Sanctum; tier-2 helms/shoulders drop in the Nythraxis raid and the tier-2
// gloves/belts from the Thunzharr world boss (content/zone3.ts).
const STRENGTH_T1_BONUSES: SetBonusTier[] = [
  { pieces: 2, effect: { ap: 40 }, text: 'Increases attack power by 40.' },
  { pieces: 3, effect: { str: 15, sta: 15 }, text: 'Increases Strength by 15 and Stamina by 15.' },
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
  { pieces: 2, effect: { ap: 40 }, text: 'Increases attack power by 40.' },
  {
    pieces: 3,
    effect: { agi: 15, critRating: SET_CRIT_3PC_RATING },
    text: 'Increases Agility by 15 and critical strike chance by 2%.',
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
    effect: { knockbackResistance: 1, sp: 20 },
    text: 'Increases spell power by 20. You cannot be knocked back (100% knockback resistance).',
  },
  {
    pieces: 3,
    effect: { int: 10, sta: 10 },
    text: 'Increases Intellect by 10 and Stamina by 10.',
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
  { pieces: 2, effect: { ap: 40 }, text: 'Increases attack power by 40.' },
  {
    pieces: 3,
    effect: { str: 15, sta: 15, hasteRating: SET_HASTE_3PC_RATING },
    text: 'Increases Strength by 15, Stamina by 15, and attack and casting speed by 15%.',
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
    text: 'Increases Hit by 6%. Your weapon critical strikes splinter the target with Bonesplinter, bleeding it for 8 damage every 2 sec for 12 sec. Stacks up to 3 times.',
  },
];
const AGILITY_T2_BONUSES: SetBonusTier[] = [
  { pieces: 2, effect: { ap: 40 }, text: 'Increases attack power by 40.' },
  {
    pieces: 3,
    effect: { agi: 15, critRating: SET_CRIT_3PC_RATING, hasteRating: SET_HASTE_3PC_RATING },
    text: 'Increases Agility by 15, critical strike chance by 2%, and attack and casting speed by 15%.',
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
    text: 'Increases Hit by 6%. Your weapon critical strikes tear a Ragged Gash, bleeding the target for 6 damage every 2 sec for 12 sec. Stacks up to 3 times.',
  },
];
const CASTER_T2_BONUSES: SetBonusTier[] = [
  {
    pieces: 2,
    effect: { knockbackResistance: 1, sp: 20 },
    text: 'Increases spell power by 20. You cannot be knocked back (100% knockback resistance).',
  },
  {
    pieces: 3,
    effect: { int: 15, spi: 15, hasteRating: SET_HASTE_3PC_RATING },
    text: 'Increases Intellect by 15, Spirit by 15, and attack and casting speed by 15%.',
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
// deliberately a single-tier reward a leveler assembles from world drops.
const HASTE_KIT_BONUSES: SetBonusTier[] = [
  {
    pieces: 3,
    effect: { hasteRating: SET_HASTE_3PC_RATING },
    text: 'Increases attack and casting speed by 15%.',
  },
];

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
    procs: [],
  };
}

// Resolve equipped set-piece counts (setId -> count) into the summed bonus.
// Stat/AP/crit effects add across every met tier; pushback and knockback
// resistance max-combine rather than summing past 1. Pure and host-agnostic so
// a Vitest can drive it directly.
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
  return out;
}
