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
  | { kind: 'heartNova'; radius: number; flat: number; coef: number }
  /** Gaoler's Iron Key: chain an enemy within `range` in place for `duration`;
   *  one immune to control is slowed to `slow` of its speed instead (a target
   *  immune to slows as well shrugs it off). */
  | { kind: 'shackle'; range: number; duration: number; slow: number }
  /** Fanglord's Whistle: a spirit jaguar fights beside you for `duration`,
   *  running to your target within `range` and biting it every
   *  `attackInterval` seconds for `min` to `max` (+ `coef` of your Attack
   *  Power, snapshotted when it is summoned) physical damage. It runs at
   *  `moveSpeed` yards per second. */
  | {
      kind: 'spiritPack';
      range: number;
      duration: number;
      attackInterval: number;
      min: number;
      max: number;
      coef: number;
      moveSpeed: number;
    }
  /** Gorgebloom Seedpod: plant a seed on your target within `range`; after
   *  `delay` seconds it bursts where the target stands (or where it died) for
   *  `flat` (+ `coef` of your Spell Power, snapshotted when it is planted)
   *  nature damage to every enemy within `radius`, `deathBonus` more if the
   *  target died first. */
  | {
      kind: 'seedburst';
      range: number;
      delay: number;
      radius: number;
      flat: number;
      coef: number;
      deathBonus: number;
    }
  /** Foreman's Last Link: chain yourself to an ally (not yourself) within
   *  `range` for `duration`; `share` of the damage that reaches their health is
   *  taken by you instead. */
  | { kind: 'tether'; range: number; duration: number; share: number }
  /** Phial of the Tithe: for `duration`, each enemy that dies within `radius`
   *  of you restores `restore` of your maximum health and mana. */
  | { kind: 'harvest'; duration: number; radius: number; restore: number }
  /** Quenchwater Flask: your next `hits` weapon hits within `duration` deal
   *  `flat` (+ `coef` of your Attack Power) bonus frost damage; the last one
   *  quenches the target, slowing its attacks by `slow` for `slowDuration`. */
  | {
      kind: 'quench';
      duration: number;
      hits: number;
      flat: number;
      coef: number;
      slow: number;
      slowDuration: number;
    }
  // ---- Balgath, the One-Eyed Foreman (combat/balgath_trinkets.ts) ----
  /** Knucklebone of Balgath: take the Shape of the Foreman for `duration`: the
   *  cyclops's body (its own abilities, same buttons, same damage), `armorPct`%
   *  more armor and immunity to knockbacks. */
  | { kind: 'foremanShape'; duration: number; armorPct: number }
  /** Muster Standard: plant a standard; `soldiers` muster soldiers rally from it
   *  for `duration`, march at your side and fight your target in melee, swinging
   *  every `attackInterval` sec for `min` to `max` (+ `coef` of Attack Power, the
   *  higher of melee and ranged, snapshotted when planted) Physical damage. Each
   *  has `hpShare` of your maximum health. Left more than `leash` yd behind they
   *  rejoin you; they leave with the standard or on your death. */
  | {
      kind: 'musterStandard';
      duration: number;
      soldiers: number;
      attackInterval: number;
      min: number;
      max: number;
      coef: number;
      hpShare: number;
      leash: number;
      moveSpeed: number;
    }
  /** The Guttered Eye: channel a beam `length` yd straight ahead for `duration`;
   *  every `every` sec it deals `flat` (+ `coef` of Spell Power) Arcane damage to
   *  up to `maxTargets` enemies in the line (`halfWidth` yd either side). You may
   *  turn to sweep it; moving ends it. */
  | {
      kind: 'gutteredGlare';
      duration: number;
      every: number;
      length: number;
      halfWidth: number;
      flat: number;
      coef: number;
      maxTargets: number;
    }
  /** Muster Grapnel: hook a party or raid member within `range` yd (in line of
   *  sight) and haul them through the air to your side in `flight` sec. */
  | { kind: 'grapnel'; range: number; flight: number; apex: number; heal: number; coef: number }
  /** A passive-only trinket (the Barrowstone Heart): nothing to use; the action
   *  bar refuses the press and the tooltip prints no Use line. */
  | { kind: 'passiveOnly' };

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
  | { kind: 'guardHeat'; max: number; duration: number }
  /** Barrowstone Heart: a hit that would kill you turns you into a stone statue
   *  for `statue` sec instead (immune to damage, unable to move or act), after
   *  which you return at `restore` of your maximum health. Its internal cooldown
   *  is the spec's `cooldown`. */
  | { kind: 'stoneHeart'; statue: number; restore: number };

export interface TrinketSpec {
  /** Seconds between uses (for a passive-only trinket: its internal cooldown). */
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
  shackle: 'trinket_shackle',
  spiritPack: 'trinket_spirit_pack',
  seedburst: 'trinket_seedburst',
  tether: 'trinket_tether',
  tetherLink: 'trinket_tether_link',
  harvest: 'trinket_harvest',
  quench: 'trinket_quench',
  quenched: 'trinket_quenched',
  foremanShape: 'trinket_foreman_shape',
  musterStandard: 'trinket_muster_standard',
  gutteredGlare: 'trinket_guttered_glare',
  stoneStatue: 'trinket_barrowstone_statue',
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
  [TRINKET_AURA.shackle]: 'gaolers_iron_key',
  [TRINKET_AURA.spiritPack]: 'fanglords_whistle',
  [TRINKET_AURA.seedburst]: 'gorgebloom_seedpod',
  [TRINKET_AURA.tether]: 'foremans_last_link',
  [TRINKET_AURA.tetherLink]: 'foremans_last_link',
  [TRINKET_AURA.harvest]: 'phial_of_the_tithe',
  [TRINKET_AURA.quench]: 'quenchwater_flask',
  [TRINKET_AURA.quenched]: 'quenchwater_flask',
  [TRINKET_AURA.foremanShape]: 'knucklebone_of_balgath',
  [TRINKET_AURA.musterStandard]: 'muster_standard',
  [TRINKET_AURA.gutteredGlare]: 'guttered_eye',
  [TRINKET_AURA.stoneStatue]: 'barrowstone_heart',
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
  // The Sunken Bastion's heroic Gaoler Ossick (the five-man heroic trinket
  // line of the Bastion Sigil).
  gaolers_iron_key: trinket('gaolers_iron_key', "Gaoler's Iron Key", { sta: 13 }),
  // The Wildheart Basin's heroic Fanglord Beastmaster and Gorgebloom (the
  // five-man heroic trinket line, docs/design/dungeon-rework/wildheart_basin.md
  // 8.2): item level 31, line budget round(31 x 0.6 x 0.7) = 13.
  fanglords_whistle: trinket('fanglords_whistle', "Fanglord's Whistle", { agi: 13 }),
  gorgebloom_seedpod: trinket('gorgebloom_seedpod', 'Gorgebloom Seedpod', { int: 13 }),
  // The Gravewyrm Sanctum's heroic bosses (the five-man heroic trinket line,
  // docs/design/dungeon-rework/gravewyrm_sanctum.md 9.2): item level 31, 13.
  foremans_last_link: trinket('foremans_last_link', "Foreman's Last Link", { sta: 13 }),
  phial_of_the_tithe: trinket('phial_of_the_tithe', 'Phial of the Tithe', { int: 13 }),
  quenchwater_flask: trinket('quenchwater_flask', 'Quenchwater Flask', { str: 13 }),
  // Balgath, the One-Eyed Foreman (the Mirefen world boss, content/zone2.ts): five
  // personal-loot trinkets at his item level 26 (a level-20 world boss epic), whose
  // trinket line is 11 points on one attribute (tests/item_level.test.ts).
  knucklebone_of_balgath: trinket('knucklebone_of_balgath', 'Knucklebone of Balgath', {
    str: 11,
  }),
  muster_standard: trinket('muster_standard', 'Muster Standard', { sta: 11 }),
  guttered_eye: trinket('guttered_eye', 'The Guttered Eye', { int: 11 }),
  barrowstone_heart: trinket('barrowstone_heart', 'Barrowstone Heart', { sta: 11 }),
  muster_grapnel: trinket('muster_grapnel', 'Muster Grapnel', { int: 11 }),
};

/** Balgath's five trinkets, in the order they sit in his loot table. */
export const BALGATH_TRINKET_ITEM_IDS: readonly string[] = [
  'knucklebone_of_balgath',
  'muster_standard',
  'guttered_eye',
  'barrowstone_heart',
  'muster_grapnel',
];

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
  gaolers_iron_key: {
    cooldown: 120,
    use: { kind: 'shackle', range: 30, duration: 6, slow: 0.7 },
  },
  // Fanglord's Whistle: one of the Packlord Stampede's three beasts (content/
  // classes.ts stampede: 18 to 24 physical plus 8 percent of the hunter's
  // power, every 2 sec, for 12 sec), so the trinket pays a third of a level-17
  // class cooldown on the five-man heroic trinkets' 2 min timer. Six bites at
  // a heroic level-20 agile's 200 to 300 Attack Power land about 220 to 270,
  // in line with a five-man heroic trinket's budget: 10 percent of a 230 DPS
  // heroic (README section 7) for 12 sec (about 276). It runs at the Fanglord's
  // Great Jaguar's speed (8 yd/s, wildheart.ts).
  fanglords_whistle: {
    cooldown: 120,
    use: {
      kind: 'spiritPack',
      range: 30,
      duration: 12,
      attackInterval: 2,
      min: 18,
      max: 24,
      coef: 0.08,
      moveSpeed: 8,
    },
  },
  // Gorgebloom Seedpod: the Stormjar's full jar on each target it strikes (ten
  // charges of 8 plus 7 percent of Spell Power: 80 plus 70 percent) re-timed
  // from its 90 sec cooldown to this 2 min one (x 4/3: about 107 plus 93
  // percent) is the burst on a target that died first (75 x 1.5 = 112.5 plus
  // 0.6 x 1.5 = 90 percent); the plain burst is two thirds of it. Like the
  // Heart of the Crucible's nova it has no target cap; the 6 sec wait and the
  // 8 yd radius are its price.
  gorgebloom_seedpod: {
    cooldown: 120,
    use: {
      kind: 'seedburst',
      range: 30,
      delay: 6,
      radius: 8,
      flat: 75,
      coef: 0.6,
      deathBonus: 0.5,
    },
  },
  // Foreman's Last Link: the classic Blessing of Sacrifice share (30 percent
  // of the damage an ally takes moves to the caster) on the five-man heroic
  // trinkets' 2 min timer, for 10 sec. It moves damage, never removes it: the
  // tank's Stamina line is its price.
  foremans_last_link: {
    cooldown: 120,
    use: { kind: 'tether', range: 20, duration: 10, share: 0.3 },
  },
  // Phial of the Tithe: 5 percent of health and mana per enemy that dies near
  // you inside 15 sec. A five-man trash pack (four to six) pays 20 to 30
  // percent, about one mana potion's worth at level 20; a lone boss pays 5.
  phial_of_the_tithe: {
    cooldown: 120,
    use: { kind: 'harvest', duration: 15, radius: 20, restore: 0.05 },
  },
  // Quenchwater Flask: three swings of 40 frost plus 20 percent of Attack
  // Power. At a heroic level-20 strength wearer's 250 Attack Power that is
  // three hits of 90 (270), in line with a five-man heroic trinket's budget:
  // 10 percent of a 230 DPS heroic for 12 sec (about 276). The third one quenches:
  // 15 percent slower attacks (the swing interval x 1 / 0.85) for 8 sec.
  quenchwater_flask: {
    cooldown: 120,
    use: {
      kind: 'quench',
      duration: 12,
      hits: 3,
      flat: 40,
      coef: 0.2,
      slow: 0.15,
      slowDuration: 8,
    },
  },
  // Balgath's five (combat/balgath_trinkets.ts). The numbers sit beside the
  // shipped trinkets and class kit they compete with: the soldiers' swing is the
  // hunter Stampede's shape (a flat range plus a small power share, snapshotted)
  // on a longer cooldown and fewer bodies.
  knucklebone_of_balgath: {
    cooldown: 120,
    use: { kind: 'foremanShape', duration: 15, armorPct: 50 },
  },
  muster_standard: {
    cooldown: 120,
    use: {
      kind: 'musterStandard',
      duration: 15,
      soldiers: 2,
      attackInterval: 2,
      min: 15,
      max: 21,
      coef: 0.07,
      hpShare: 0.35,
      leash: 40,
      moveSpeed: 7.5,
    },
  },
  // The glare is budgeted against its sister, the Muster Standard: same boss, same item
  // level, same 2 min cooldown, so the same base damage. Two soldiers swing 7.5 times each
  // in their 15 sec for 18 on average: 270 to one target. The glare's six ticks of 45 are
  // that 270, front-loaded into 3 sec and laid on everything in the line. It shipped at
  // 18 a tick (108 in all), well under the 3 sec of ordinary casting the channel costs a
  // level 20 caster, which is why it read as a trinket that did nothing (owner playtest).
  // The Spell Power share stays the classic one for an area channel: 3 sec / 3.5 halved
  // for hitting many, spread over six ticks (about 0.07, rounded up to 0.08).
  guttered_eye: {
    cooldown: 120,
    use: {
      kind: 'gutteredGlare',
      duration: 3,
      every: 0.5,
      length: 30,
      halfWidth: 1.25,
      flat: 45,
      coef: 0.08,
      maxTargets: 8,
    },
  },
  barrowstone_heart: {
    cooldown: 180,
    use: { kind: 'passiveOnly' },
    passive: { kind: 'stoneHeart', statue: 3, restore: 0.2 },
  },
  muster_grapnel: {
    cooldown: 90,
    // The haul lands with a heal: 120 plus 40% of Healing Power (about a classic rank-4
    // Flash Heal's weight, the 1.5 / 3.5 direct-heal coefficient), on a 90 sec cooldown.
    use: { kind: 'grapnel', range: 30, flight: 0.6, apex: 2.4, heal: 120, coef: 0.4 },
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
