// Item sets and their equipped-piece bonuses (classic "tier set" style).
//
// The sets are the epic armor families that drop from the Gravewyrm Sanctum
// (tier 1) and the Nythraxis raid (tier 2). Wearing enough pieces of a family
// grants stacking 2- and 3-piece bonuses, resolved in `recalcPlayerStats`
// (primary stats, attack power, crit) and, for caster sets, in
// `Sim.pushbackCast` (cast-interrupt pushback from damage).
//
// Bonuses are keyed by archetype: the plate (Strength) families get attack
// power then Strength/Stamina; the leather (Agility) families get attack power
// then Agility/crit; the cloth (caster) families get cast-pushback reduction.
// This file is data-as-code: balance numbers live here, never inline in the
// engine. `aggregateSetBonuses` is the pure resolver imported by `entity.ts`.

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
// 3-piece bonuses); cast pushback reduction max-combines (see the resolver).
// Tier-2 families ship only two pieces today, so they reach the 2-piece tier.
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
const CASTER_BONUSES: SetBonusTier[] = [
  {
    pieces: 2,
    effect: { castPushbackReduction: 0.5 },
    text: 'Reduces cast pushback from damage by 50%.',
  },
  {
    pieces: 3,
    effect: { castPushbackReduction: 1 },
    text: 'You cannot be pushed back while casting (immune to cast pushback from damage).',
  },
];

export const ITEM_SETS: Record<string, ItemSet> = {
  [SET_DEATHLORD]: { id: SET_DEATHLORD, name: 'Deathlord Battlegear', bonuses: STRENGTH_BONUSES },
  [SET_WYRMSHADOW]: { id: SET_WYRMSHADOW, name: 'Wyrmshadow Vestments', bonuses: AGILITY_BONUSES },
  [SET_NECROMANCERS]: {
    id: SET_NECROMANCERS,
    name: "Necromancer's Raiment",
    bonuses: CASTER_BONUSES,
  },
  [SET_CROWNFORGED]: {
    id: SET_CROWNFORGED,
    name: 'Crownforged Regalia',
    bonuses: STRENGTH_BONUSES,
  },
  [SET_NIGHTTALON]: { id: SET_NIGHTTALON, name: 'Nighttalon Pelt', bonuses: AGILITY_BONUSES },
  [SET_SOULFLAME]: { id: SET_SOULFLAME, name: 'Soulflame Regalia', bonuses: CASTER_BONUSES },
  [SET_STORMCALLERS]: {
    id: SET_STORMCALLERS,
    name: "Stormcaller's Vestments",
    bonuses: CASTER_BONUSES,
  },
};

// Fully-resolved set effect: every field defaulted so callers never branch on
// undefined. `castPushbackReduction` is clamped to 0..1.
export interface AggregatedSetEffect {
  str: number;
  agi: number;
  sta: number;
  int: number;
  spi: number;
  ap: number;
  crit: number;
  castPushbackReduction: number;
}

function zeroEffect(): AggregatedSetEffect {
  return { str: 0, agi: 0, sta: 0, int: 0, spi: 0, ap: 0, crit: 0, castPushbackReduction: 0 };
}

// Resolve equipped set-piece counts (setId -> count) into the summed bonus.
// Stat/AP/crit effects add across every met tier; cast pushback reduction
// max-combines (so the 3-piece 100% supersedes the 2-piece 50% rather than
// summing past 1). Pure and host-agnostic so a Vitest can drive it directly.
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
    }
  }
  out.castPushbackReduction = Math.min(1, Math.max(0, out.castPushbackReduction));
  return out;
}
