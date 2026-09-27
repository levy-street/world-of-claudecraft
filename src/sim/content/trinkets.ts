// The trinkets: the one trinket slot's items and what each one DOES. Every
// trinket carries a single primary attribute (its stat identity, sized to the
// slot's accessory budget by the item-level source that sells or drops it) and a
// mechanic of its own: an effect used from the action bar, a passive, or both.
// None of them is a flat "+stats for 20 seconds" button: each use does something
// (a shield, a strike, a blink, a cleanse), in the classic trinket tradition.
// The mechanics run in src/sim/combat/trinkets.ts; this file is data only.
//
// Numbers are tunable. Damage, healing and absorbs scale with the wearer's own
// power where the tooltip says so (Attack Power for physical, Spell Power for
// spells, Healing Power for heals); everything else is a flat, stated value.

import type { ItemDef } from '../types';

/** What a trinket does when used from the action bar. */
export type TrinketUse =
  /** Bastion Sigil: for `duration`, strike back at whoever hits you for
   *  `reflect` of the damage they dealt. */
  | { kind: 'retaliate'; duration: number; reflect: number }
  /** Mooring Stone: for `duration`, take `reduction` less damage and shrug off
   *  every stun, root, slow, fear and knockback, at `speed` movement. */
  | { kind: 'anchor'; duration: number; reduction: number; speed: number }
  /** Mender's Hourglass: pour the stored overhealing onto the most wounded ally
   *  within `range` as an absorb shield for `duration`. */
  | { kind: 'hourglass'; range: number; duration: number }
  /** Wellspring Seed: allies within `radius` heal `tick` (+ `coef` of Healing
   *  Power) every `every` seconds for `duration`. */
  | {
      kind: 'wellspring';
      radius: number;
      duration: number;
      every: number;
      tick: number;
      coef: number;
    }
  /** Paired Talons: for `duration`, every weapon hit opens a bleed of `tick`
   *  (+ `coef` of Attack Power) every 2 s for 6 s, stacking to `stacks`. */
  | { kind: 'bleedEdge'; duration: number; tick: number; coef: number; stacks: number }
  /** Hunter's Tally: spend every tally mark on a strike for `perMark` (+ `coef`
   *  of Attack Power) physical damage per mark. */
  | { kind: 'tallyStrike'; range: number; perMark: number; coef: number }
  /** Stormjar: empty the jar into a bolt that jumps to `jumps` enemies within
   *  `jumpRange` of each other, `perCharge` (+ `coef` of Spell Power) nature
   *  damage per charge. */
  | {
      kind: 'stormjar';
      range: number;
      jumps: number;
      jumpRange: number;
      perCharge: number;
      coef: number;
    }
  /** Echoing Lens: your next `casts` spells within `duration` echo for `echo`
   *  of their damage or healing. */
  | { kind: 'echo'; duration: number; casts: number; echo: number }
  /** Gambler's Die: roll one of four fortunes for `duration`. */
  | { kind: 'gamble'; duration: number }
  /** Sundered Prism: step `yards` forward through the rift, then take `reduction`
   *  less damage for `guard` seconds. */
  | { kind: 'blink'; yards: number; guard: number; reduction: number }
  /** Wayfarer's Lodestone: run at `speed` for `duration`. */
  | { kind: 'sprint'; duration: number; speed: number }
  /** Medallion of Defiance: break free of every stun, root, slow, fear,
   *  polymorph, silence and daze on you. */
  | { kind: 'defiance' }
  /** Duelist's Brand: brand an enemy player within `range`: healing they
   *  receive is cut by `cut` for `duration`. */
  | { kind: 'brand'; range: number; duration: number; cut: number }
  /** Forgefather's Temper: for `duration`, every weapon hit adds `flat` (+ `coef`
   *  of Attack Power) fire damage, `perHeat` more for each heat stack the use
   *  spent; a kill while it burns adds `killExtend` seconds, up to `maxDuration`. */
  | {
      kind: 'temper';
      duration: number;
      flat: number;
      coef: number;
      perHeat: number;
      killExtend: number;
      maxDuration: number;
    }
  /** Kindling Orb: an ember orb floats beside you for `duration`; every damage
   *  spell you cast makes it loose a bolt of `flat` (+ `coef` of Spell Power)
   *  fire damage at the same target. */
  | { kind: 'kindlingOrb'; duration: number; flat: number; coef: number }
  /** Molten Fletching: for `duration`, every weapon hit also strikes the enemy
   *  nearest your target (within `reach`) for `share` of the damage. */
  | { kind: 'pierce'; duration: number; reach: number; share: number }
  /** Last Flame Lantern: set a lantern at your feet for `duration`. A heal that
   *  lands on an ally within `radius` of it splashes `share` onto the most
   *  wounded other ally in its light. */
  | { kind: 'lantern'; duration: number; radius: number; share: number }
  /** Heart of the Crucible: spend every heat stack on a fire nova within
   *  `radius`, `flat` (+ `coef` of Attack Power) fire damage per stack, that
   *  taunts every creature it hits. */
  | { kind: 'heartNova'; radius: number; flat: number; coef: number };

/** What a trinket does on its own while worn. */
export type TrinketPassive =
  /** Bastion Sigil: dropping below `belowHp` of your health raises a shield
   *  worth `absorb` of your max health, once every `icd` seconds. */
  | { kind: 'lastStand'; belowHp: number; absorb: number; icd: number; duration: number }
  /** Mender's Hourglass: overhealing you deal fills the hourglass, up to `cap`
   *  of your max health. */
  | { kind: 'hourglass'; cap: number }
  /** Paired Talons: a landed melee swing has `chance` to swing again (once every
   *  `icd` seconds). */
  | { kind: 'twinStrike'; chance: number; icd: number }
  /** Hunter's Tally: a weapon crit or a kill adds a tally mark, up to `max`,
   *  kept for `duration`. */
  | { kind: 'tally'; max: number; duration: number }
  /** Stormjar: every spell you cast adds a charge, up to `max`, kept for
   *  `duration`. */
  | { kind: 'storm'; max: number; duration: number }
  /** Forgefather's Temper: each weapon hit adds a heat stack, up to `max`, kept
   *  for `duration`. */
  | { kind: 'heat'; max: number; duration: number }
  /** Molten Fletching: a weapon crit sets the target alight for `ticks` ticks of
   *  `flat` (+ `coef` of Attack Power) fire damage every 2 s. */
  | { kind: 'ignite'; ticks: number; flat: number; coef: number }
  /** Heart of the Crucible: each parry, dodge or block you make adds a heat
   *  stack, up to `max`, kept for `duration`. */
  | { kind: 'guardHeat'; max: number; duration: number };

export interface TrinketSpec {
  /** Seconds between uses. */
  cooldown: number;
  use: TrinketUse;
  passive?: TrinketPassive;
}

/** The aura ids the trinkets keep their state and effects on. */
export const TRINKET_AURA = Object.freeze({
  lastStandIcd: 'trinket_last_stand_icd',
  lastStand: 'trinket_last_stand',
  retaliate: 'trinket_retaliate',
  anchor: 'trinket_anchor',
  anchorGuard: 'trinket_anchor_guard',
  hourglass: 'trinket_hourglass',
  hourglassShield: 'trinket_hourglass_shield',
  wellspring: 'trinket_wellspring',
  twinStrikeIcd: 'trinket_twin_strike_icd',
  bleedEdge: 'trinket_bleed_edge',
  bleed: 'trinket_paired_talons_bleed',
  tally: 'trinket_tally',
  storm: 'trinket_storm',
  echo: 'trinket_echo',
  fortune: 'trinket_fortune',
  riftGuard: 'trinket_rift_guard',
  sprint: 'trinket_sprint',
  brand: 'trinket_brand',
  heat: 'trinket_forge_heat',
  temper: 'trinket_temper',
  kindlingOrb: 'trinket_kindling_orb',
  ignite: 'trinket_molten_ignite',
  pierce: 'trinket_pierce',
  lantern: 'trinket_lantern',
  guardHeat: 'trinket_crucible_heat',
});

/** The Mooring Stone's self-slow rides its own aura id beside the anchor
 *  (combat/trinkets.ts applies it as `${TRINKET_AURA.anchor}_slow`). */
export const TRINKET_ANCHOR_SLOW_AURA = `${TRINKET_AURA.anchor}_slow`;

/** Which trinket owns each aura the trinkets apply, so the buff bar, the target
 *  frame and the nameplates paint the trinket's own item icon on it (the UI's
 *  aura art registry reads this map; src/ui/trinket_aura_art.ts). Every
 *  TRINKET_AURA id is here, plus the Mooring Stone's slow. Data only. */
export const TRINKET_AURA_ITEM: Readonly<Record<string, string>> = Object.freeze({
  [TRINKET_AURA.lastStandIcd]: 'bastion_sigil',
  [TRINKET_AURA.lastStand]: 'bastion_sigil',
  [TRINKET_AURA.retaliate]: 'bastion_sigil',
  [TRINKET_AURA.anchor]: 'mooring_stone',
  [TRINKET_AURA.anchorGuard]: 'mooring_stone',
  [TRINKET_ANCHOR_SLOW_AURA]: 'mooring_stone',
  [TRINKET_AURA.hourglass]: 'menders_hourglass',
  [TRINKET_AURA.hourglassShield]: 'menders_hourglass',
  [TRINKET_AURA.wellspring]: 'wellspring_seed',
  [TRINKET_AURA.twinStrikeIcd]: 'paired_talons',
  [TRINKET_AURA.bleedEdge]: 'paired_talons',
  [TRINKET_AURA.bleed]: 'paired_talons',
  [TRINKET_AURA.tally]: 'hunters_tally',
  [TRINKET_AURA.storm]: 'stormjar',
  [TRINKET_AURA.echo]: 'echoing_lens',
  [TRINKET_AURA.fortune]: 'gamblers_die',
  [TRINKET_AURA.riftGuard]: 'sundered_prism',
  [TRINKET_AURA.sprint]: 'wayfarers_lodestone',
  [TRINKET_AURA.brand]: 'duelists_brand',
  [TRINKET_AURA.heat]: 'forgefathers_temper',
  [TRINKET_AURA.temper]: 'forgefathers_temper',
  [TRINKET_AURA.kindlingOrb]: 'kindling_orb',
  [TRINKET_AURA.ignite]: 'molten_fletching',
  [TRINKET_AURA.pierce]: 'molten_fletching',
  [TRINKET_AURA.lantern]: 'last_flame_lantern',
  [TRINKET_AURA.guardHeat]: 'heart_of_the_crucible',
});

/** The cooldown key a trinket's use rides in the wearer's cooldown map (wired to
 *  the client and persisted like an ability's). */
export function trinketCooldownKey(itemId: string): string {
  return `trinket:${itemId}`;
}

export function isTrinketCooldownKey(key: string): boolean {
  return key.startsWith('trinket:');
}

const trinket = (
  id: string,
  name: string,
  stats: ItemDef['stats'],
  quality: 'rare' | 'epic' = 'epic',
): ItemDef => ({
  id,
  name,
  kind: 'armor',
  slot: 'trinket',
  quality,
  requiredLevel: 20,
  stats,
  sellValue: 4500,
  soulbound: true,
});

// Stat values are the item-level budget of each trinket's source (checked by
// tests/item_level.test.ts through the source index): exactly one attribute
// each, the whole line budget on it (the trinket slot is exempt from the
// stamina baseline model, see STAMINA_MODEL_EXEMPT_SLOTS in item_budget.ts).
// The two honor trinkets follow the WARFARE jewelry rule instead
// (content/pvp_honor.ts): one attribute at WARFARE_JEWELRY_STAT_FRACTION of the
// item-level-31 trinket line (13 x 0.75, rounded: 10), plus WARFARE Offense and
// Defense Rating at WARFARE_RATING_FRACTION of that line (the full 13 each).
// Like all honor gear they carry their honor price and sell for nothing.
export const TRINKET_ITEMS: Record<string, ItemDef> = {
  bastion_sigil: trinket('bastion_sigil', 'Bastion Sigil', { sta: 13 }),
  mooring_stone: trinket('mooring_stone', 'Mooring Stone', { str: 14 }),
  menders_hourglass: trinket('menders_hourglass', "Mender's Hourglass", { int: 13 }),
  wellspring_seed: trinket('wellspring_seed', 'Wellspring Seed', { int: 14 }),
  paired_talons: trinket('paired_talons', 'Paired Talons', { agi: 13 }),
  hunters_tally: trinket('hunters_tally', "Hunter's Tally", { str: 14 }),
  stormjar: trinket('stormjar', 'Stormjar', { int: 13 }),
  echoing_lens: trinket('echoing_lens', 'Echoing Lens', { int: 14 }),
  gamblers_die: trinket('gamblers_die', "Gambler's Die", { agi: 13 }),
  sundered_prism: trinket('sundered_prism', 'Sundered Prism', { sta: 13 }),
  wayfarers_lodestone: trinket('wayfarers_lodestone', "Wayfarer's Lodestone", { spi: 11 }),
  medallion_of_defiance: {
    ...trinket('medallion_of_defiance', 'Medallion of Defiance', { sta: 10 }),
    pvpOffenseRating: 13,
    pvpDefenseRating: 13,
    priceHonor: 800,
    sellValue: 0,
  },
  duelists_brand: {
    ...trinket('duelists_brand', "Duelist's Brand", { agi: 10 }),
    pvpOffenseRating: 13,
    pvpDefenseRating: 13,
    priceHonor: 800,
    sellValue: 0,
  },
  // The Crucible of the Last Spring raid trinkets (Ignivar and Varkhul), the
  // item level 35 tier. Stat values are set to the raid tier's line budget.
  forgefathers_temper: trinket('forgefathers_temper', "Forgefather's Temper", { str: 15 }),
  kindling_orb: trinket('kindling_orb', 'Kindling Orb', { int: 15 }),
  molten_fletching: trinket('molten_fletching', 'Molten Fletching', { agi: 15 }),
  last_flame_lantern: trinket('last_flame_lantern', 'Last Flame Lantern', { spi: 15 }),
  heart_of_the_crucible: trinket('heart_of_the_crucible', 'Heart of the Crucible', { sta: 15 }),
};

// The Crucible of the Last Spring raid trinkets, in the order they sit in their
// bosses' loot. They drop on BOTH difficulties: in each boss's Normal-only
// off-set partition (content/dungeons.ts) and in its Heroic exclusive
// partition (HEROIC_BOSS_LOOT in heroic_loot.ts). Ignivar pays the first
// three, Varkhul the last two. item_level.ts registers them at the
// Crucible raid tier (IGNIVAR_RAID_LOOT_SOURCE_LEVEL, item level 35).
export const CRUCIBLE_TRINKET_ITEM_IDS: readonly string[] = [
  'kindling_orb',
  'molten_fletching',
  'last_flame_lantern',
  'forgefathers_temper',
  'heart_of_the_crucible',
];

export const TRINKET_SPECS: Readonly<Record<string, TrinketSpec>> = Object.freeze({
  bastion_sigil: {
    cooldown: 120,
    use: { kind: 'retaliate', duration: 8, reflect: 0.3 },
    passive: { kind: 'lastStand', belowHp: 0.35, absorb: 0.15, icd: 90, duration: 10 },
  },
  mooring_stone: {
    cooldown: 180,
    use: { kind: 'anchor', duration: 8, reduction: 0.2, speed: 0.7 },
  },
  menders_hourglass: {
    cooldown: 90,
    use: { kind: 'hourglass', range: 40, duration: 12 },
    passive: { kind: 'hourglass', cap: 0.3 },
  },
  wellspring_seed: {
    cooldown: 120,
    use: { kind: 'wellspring', radius: 10, duration: 10, every: 2, tick: 18, coef: 0.12 },
  },
  paired_talons: {
    cooldown: 120,
    use: { kind: 'bleedEdge', duration: 10, tick: 4, coef: 0.03, stacks: 5 },
    passive: { kind: 'twinStrike', chance: 0.06, icd: 3 },
  },
  hunters_tally: {
    cooldown: 60,
    use: { kind: 'tallyStrike', range: 30, perMark: 10, coef: 0.08 },
    passive: { kind: 'tally', max: 10, duration: 30 },
  },
  stormjar: {
    cooldown: 90,
    use: { kind: 'stormjar', range: 30, jumps: 4, jumpRange: 12, perCharge: 8, coef: 0.07 },
    passive: { kind: 'storm', max: 10, duration: 30 },
  },
  echoing_lens: {
    cooldown: 120,
    use: { kind: 'echo', duration: 12, casts: 3, echo: 0.3 },
  },
  gamblers_die: {
    cooldown: 120,
    use: { kind: 'gamble', duration: 15 },
  },
  sundered_prism: {
    cooldown: 90,
    use: { kind: 'blink', yards: 12, guard: 3, reduction: 0.3 },
  },
  wayfarers_lodestone: {
    cooldown: 120,
    use: { kind: 'sprint', duration: 8, speed: 1.6 },
  },
  medallion_of_defiance: {
    cooldown: 120,
    use: { kind: 'defiance' },
  },
  duelists_brand: {
    cooldown: 60,
    use: { kind: 'brand', range: 30, duration: 8, cut: 0.5 },
  },
  forgefathers_temper: {
    cooldown: 90,
    use: {
      kind: 'temper',
      duration: 10,
      flat: 6,
      coef: 0.08,
      perHeat: 0.15,
      killExtend: 2,
      maxDuration: 20,
    },
    passive: { kind: 'heat', max: 5, duration: 20 },
  },
  kindling_orb: {
    cooldown: 120,
    use: { kind: 'kindlingOrb', duration: 12, flat: 12, coef: 0.12 },
  },
  molten_fletching: {
    cooldown: 90,
    use: { kind: 'pierce', duration: 10, reach: 8, share: 0.4 },
    passive: { kind: 'ignite', ticks: 3, flat: 4, coef: 0.03 },
  },
  last_flame_lantern: {
    cooldown: 120,
    use: { kind: 'lantern', duration: 12, radius: 12, share: 0.25 },
  },
  heart_of_the_crucible: {
    cooldown: 60,
    use: { kind: 'heartNova', radius: 10, flat: 8, coef: 0.05 },
    passive: { kind: 'guardHeat', max: 10, duration: 30 },
  },
});

/** The four fortunes of the Gambler's Die, rolled with the sim's own Rng. */
export const GAMBLE_FORTUNES = ['keenEdge', 'luckyHeal', 'gildedGuard', 'snakeEyes'] as const;
export type GambleFortune = (typeof GAMBLE_FORTUNES)[number];
export const GAMBLE = Object.freeze({
  /** Keen Edge: this much more damage dealt for the fortune's duration. */
  keenEdgeDamage: 0.15,
  /** Lucky Heal: this share of max health over the fortune's duration. */
  luckyHealShare: 0.3,
  /** Gilded Guard: an absorb worth this share of max health. */
  gildedGuardShare: 0.2,
  /** Snake Eyes: nothing, but half the cooldown comes back. */
  snakeEyesRefund: 0.5,
});

export function trinketSpec(itemId: string | null | undefined): TrinketSpec | undefined {
  return itemId ? TRINKET_SPECS[itemId] : undefined;
}
