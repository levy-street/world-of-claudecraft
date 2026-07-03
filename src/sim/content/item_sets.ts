// Item sets and their equipped-piece bonuses (classic "tier set" style).
//
// The sets are the epic armor families that drop from the Gravewyrm Sanctum
// (tier 1) and the Nythraxis raid (tier 2). Wearing enough pieces of a family
// grants stacking 2- and 3-piece bonuses, resolved in `recalcPlayerStats`
// (primary stats, attack power, crit, knockback resistance).
//
// Bonuses are keyed by archetype: the plate (Strength) families get attack
// power then Strength/Stamina; the leather (Agility) families get attack power
// then Agility/crit; the cloth (caster) families get knockback resistance at 2
// pieces and Intellect plus Stamina for tier 1, or Intellect plus Spirit for
// tier 2, at 3 pieces. This file is data-as-code: balance numbers live here,
// never inline in the engine. `aggregateSetBonuses` is the pure resolver
// imported by `entity.ts`.

import type { ItemSet, SetBonusEffect, SetBonusTier } from '../types';

// Set ids. Tier-1 families drop from the Gravewyrm Sanctum; tier-2 from the
// Nythraxis raid. The string is also the `set` tag on each member item.
export const SET_DEATHLORD = 'deathlord'; // t1 plate, Strength
export const SET_WYRMSHADOW = 'wyrmshadow'; // t1 leather, Agility
export const SET_NECROMANCERS = 'necromancers'; // t1 cloth, caster
export const SET_CROWNFORGED = 'crownforged'; // t2 plate, Strength
export const SET_NIGHTTALON = 'nighttalon'; // t2 leather, Agility
export const SET_SOULFLAME = 'soulflame'; // t2 cloth, caster
export const SET_STORMCALLERS = 'stormcallers'; // t2 cloth (shaman), caster

// Archetype bonus tiers. Tiers stack (a 3-piece set grants both the 2- and
// 3-piece bonuses); cast pushback reduction and knockback resistance
// max-combine (see the resolver).
// Every family reaches its 3-piece tier: tier-1 pieces drop in the Gravewyrm
// Sanctum; tier-2 helms/shoulders drop in the Nythraxis raid and the tier-2
// gloves/belts from the Thunzharr world boss (content/zone3.ts).
const STRENGTH_BONUSES: SetBonusTier[] = [
  { pieces: 2, effect: { ap: 40 }, text: 'Increases attack power by 40.' },
  { pieces: 3, effect: { str: 15, sta: 15 }, text: 'Increases Strength by 15 and Stamina by 15.' },
];
const AGILITY_BONUSES: SetBonusTier[] = [
  { pieces: 2, effect: { ap: 40 }, text: 'Increases attack power by 40.' },
  {
    pieces: 3,
    effect: { agi: 15, crit: 0.02 },
    text: 'Increases Agility by 15 and critical strike chance by 2%.',
  },
];
const CASTER_T1_BONUSES: SetBonusTier[] = [
  {
    pieces: 2,
    effect: { knockbackResistance: 1 },
    text: 'You cannot be knocked back (100% knockback resistance).',
  },
  {
    pieces: 3,
    effect: { int: 10, sta: 10 },
    text: 'Increases Intellect by 10 and Stamina by 10.',
  },
];
const CASTER_T2_BONUSES: SetBonusTier[] = [
  {
    pieces: 2,
    effect: { knockbackResistance: 1 },
    text: 'You cannot be knocked back (100% knockback resistance).',
  },
  {
    pieces: 3,
    effect: { int: 15, spi: 15 },
    text: 'Increases Intellect by 15 and Spirit by 15.',
  },
];

export const ITEM_SETS: Record<string, ItemSet> = {
  [SET_DEATHLORD]: { id: SET_DEATHLORD, name: 'Barrowlord Battlegear', bonuses: STRENGTH_BONUSES },
  [SET_WYRMSHADOW]: { id: SET_WYRMSHADOW, name: 'Nightfang Vestments', bonuses: AGILITY_BONUSES },
  [SET_NECROMANCERS]: {
    id: SET_NECROMANCERS,
    name: 'Mournweave Raiment',
    bonuses: CASTER_T1_BONUSES,
  },
  [SET_CROWNFORGED]: {
    id: SET_CROWNFORGED,
    name: 'Bonewrought Regalia',
    bonuses: STRENGTH_BONUSES,
  },
  [SET_NIGHTTALON]: { id: SET_NIGHTTALON, name: 'Direfang Pelt', bonuses: AGILITY_BONUSES },
  [SET_SOULFLAME]: { id: SET_SOULFLAME, name: 'Wraithfire Regalia', bonuses: CASTER_T2_BONUSES },
  [SET_STORMCALLERS]: {
    id: SET_STORMCALLERS,
    name: 'Galecall Vestments',
    bonuses: CASTER_T2_BONUSES,
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
  crit: number;
  castPushbackReduction: number;
  knockbackResistance: number;
}

function zeroEffect(): AggregatedSetEffect {
  return {
    str: 0,
    agi: 0,
    sta: 0,
    int: 0,
    spi: 0,
    ap: 0,
    crit: 0,
    castPushbackReduction: 0,
    knockbackResistance: 0,
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
      out.crit += e.crit ?? 0;
      if (e.castPushbackReduction != null) {
        out.castPushbackReduction = Math.max(out.castPushbackReduction, e.castPushbackReduction);
      }
      if (e.knockbackResistance != null) {
        out.knockbackResistance = Math.max(out.knockbackResistance, e.knockbackResistance);
      }
    }
  }
  out.castPushbackReduction = Math.min(1, Math.max(0, out.castPushbackReduction));
  out.knockbackResistance = Math.min(1, Math.max(0, out.knockbackResistance));
  return out;
}
