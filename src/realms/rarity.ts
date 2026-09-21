// Item rarity + affix model for realm overlays.
//
// Lives next to the realm registry because it's a realm-overlay concept
// (Diablo-style item tiers) layered on top of the upstream ItemDef. The
// upstream sim still owns the loot table; this module only describes how a
// realm-themed item should be tagged, colored, glowed, and named.

import { Rng } from '../sim/rng';

export type RarityId = 'common' | 'magic' | 'rare' | 'legendary' | 'mythic' | 'unique';

export interface RarityDef {
  id: RarityId;
  name: string;
  /** CSS hex for item name tint. */
  color: string;
  /** CSS box-shadow / outline string used by tooltip + ground item beam. */
  glow: string;
  /** Number of random affixes rolled (unique uses fixed list, ignores this). */
  affixCount: number;
  /** Drop weight for the weighted random roll. */
  weight: number;
}

export const RARITY: Record<RarityId, RarityDef> = {
  common:    { id: 'common',    name: 'Common',    color: '#9e9e9e', glow: 'none',                                            affixCount: 0, weight: 50 },
  magic:     { id: 'magic',     name: 'Magic',     color: '#4a9eff', glow: '0 0 8px #4a9eff55',                               affixCount: 2, weight: 30 },
  rare:      { id: 'rare',      name: 'Rare',      color: '#ffd700', glow: '0 0 12px #ffd70055',                              affixCount: 4, weight: 12 },
  legendary: { id: 'legendary', name: 'Legendary', color: '#ff8c00', glow: '0 0 16px #ff8c0066',                              affixCount: 5, weight: 5 },
  mythic:    { id: 'mythic',    name: 'Mythic',    color: '#ff1493', glow: '0 0 20px #ff149388',                              affixCount: 6, weight: 2 },
  unique:    { id: 'unique',    name: 'Unique',    color: '#a855f7', glow: '0 0 24px #a855f799, inset 0 0 8px #a855f744',     affixCount: 0, weight: 1 },
};

export const RARITY_ORDER: readonly RarityId[] = [
  'common', 'magic', 'rare', 'legendary', 'mythic', 'unique',
];

export type RealmItemSlot = 'weapon' | 'helmet' | 'armor' | 'gloves' | 'boots' | 'ring' | 'amulet' | 'belt';

export interface RealmItemSlotDef {
  id: RealmItemSlot;
  name: string;
  icon: string;
}

export const ITEM_SLOTS: Record<RealmItemSlot, RealmItemSlotDef> = {
  weapon: { id: 'weapon', name: 'Weapon', icon: '⚔' },
  helmet: { id: 'helmet', name: 'Helmet', icon: '\u{1FA96}' },
  armor:  { id: 'armor',  name: 'Armor',  icon: '\u{1F6E1}' },
  gloves: { id: 'gloves', name: 'Gloves', icon: '\u{1F9E4}' },
  boots:  { id: 'boots',  name: 'Boots',  icon: '\u{1F462}' },
  ring:   { id: 'ring',   name: 'Ring',   icon: '\u{1F48D}' },
  amulet: { id: 'amulet', name: 'Amulet', icon: '\u{1F4FF}' },
  belt:   { id: 'belt',   name: 'Belt',   icon: '\u{1F517}' },
};

export interface AffixDef {
  name: string;
  /** Stat key the affix grants. */
  stat: string;
  /** Inclusive min / max roll range. */
  min: number;
  max: number;
}

export interface AffixPool {
  prefixes: AffixDef[];
  suffixes: AffixDef[];
}

export const AFFIX_POOL: AffixPool = {
  prefixes: [
    { name: 'Sharp',       stat: 'dmg',       min: 3,    max: 12 },
    { name: 'Cruel',       stat: 'dmg',       min: 8,    max: 25 },
    { name: 'Sturdy',      stat: 'def',       min: 5,    max: 20 },
    { name: 'Arcane',      stat: 'maxMp',     min: 10,   max: 40 },
    { name: 'Vital',       stat: 'maxHp',     min: 15,   max: 60 },
    { name: 'Swift',       stat: 'spd',       min: 0.1,  max: 0.4 },
    { name: "Berserker's", stat: 'str',       min: 3,    max: 12 },
    { name: "Viper's",     stat: 'dex',       min: 3,    max: 12 },
    { name: "Scholar's",   stat: 'nrg',       min: 3,    max: 12 },
    { name: 'Vampiric',    stat: 'lifeLeech', min: 1,    max: 8 },
    { name: 'Fiery',       stat: 'fireDmg',   min: 5,    max: 30 },
    { name: 'Frozen',      stat: 'coldDmg',   min: 5,    max: 30 },
    { name: 'Charged',     stat: 'ltngDmg',   min: 5,    max: 30 },
  ],
  suffixes: [
    { name: 'of the Bear',   stat: 'str',       min: 2,   max: 10 },
    { name: 'of the Hawk',   stat: 'dex',       min: 2,   max: 10 },
    { name: 'of the Whale',  stat: 'maxHp',     min: 10,  max: 50 },
    { name: 'of the Fox',    stat: 'nrg',       min: 2,   max: 10 },
    { name: 'of Warding',    stat: 'def',       min: 3,   max: 15 },
    { name: 'of Speed',      stat: 'spd',       min: 0.1, max: 0.3 },
    { name: 'of Absorption', stat: 'dmgReduce', min: 1,   max: 8 },
    { name: 'of the Leech',  stat: 'manaLeech', min: 1,   max: 6 },
    { name: 'of Flames',     stat: 'fireRes',   min: 5,   max: 25 },
    { name: 'of Frost',      stat: 'coldRes',   min: 5,   max: 25 },
    { name: 'of Thunder',    stat: 'ltngRes',   min: 5,   max: 25 },
    { name: 'of Blight',     stat: 'poisDmg',   min: 5,   max: 20 },
  ],
};

export function rarityRank(r: RarityId): number {
  return RARITY_ORDER.indexOf(r);
}

/** Roll a weighted random rarity. magicFind biases away from common. */
export function rollRarity(rng: Rng, magicFind = 0): RarityId {
  const weights = RARITY_ORDER.map((r) => {
    const base = RARITY[r].weight;
    if (r === 'common') return Math.max(5, base - magicFind * 0.5);
    return base + magicFind * (r === 'unique' ? 0.3 : r === 'mythic' ? 0.5 : 1);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < RARITY_ORDER.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return RARITY_ORDER[i];
  }
  return 'common';
}

export interface RealmItem {
  id: string;
  slot: RealmItemSlot;
  rarity: RarityId;
  itemLevel: number;
  color: string;
  glow: string;
  name?: string;
  affixes: RealmAffixRoll[];
}

export interface RealmAffixRoll {
  name: string;
  stat: string;
  value: number;
}

const SLOT_NAMES: Record<RealmItemSlot, string> = {
  weapon: 'Blade',
  helmet: 'Helm',
  armor: 'Plate',
  gloves: 'Grips',
  boots: 'Treads',
  ring: 'Band',
  amulet: 'Pendant',
  belt: 'Sash',
};

function shuffle<T>(rng: Rng, arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function rollAffix(rng: Rng, def: AffixDef): RealmAffixRoll {
  const value = def.min + rng.next() * (def.max - def.min);
  return { name: def.name, stat: def.stat, value: Math.round(value * 100) / 100 };
}

export function generateRealmItem(
  rng: Rng,
  slot: RealmItemSlot,
  rarity: RarityId,
  itemLevel = 1,
): RealmItem {
  const r = RARITY[rarity];
  const id = `item_${itemLevel}_${rng.int(0, 0xffffff).toString(16)}`;
  const base: RealmItem = {
    id, slot, rarity, itemLevel,
    color: r.color, glow: r.glow,
    affixes: [],
  };
  if (rarity === 'unique') {
    // Unique names are realm-specific and live in the realm content packs.
    return base;
  }
  const prefixCount = Math.ceil(r.affixCount / 2);
  const suffixCount = Math.floor(r.affixCount / 2);
  const prefixes = shuffle(rng, AFFIX_POOL.prefixes).slice(0, prefixCount).map((p) => rollAffix(rng, p));
  const suffixes = shuffle(rng, AFFIX_POOL.suffixes).slice(0, suffixCount).map((s) => rollAffix(rng, s));
  base.affixes = [...prefixes, ...suffixes];
  const prefixName = prefixes[0]?.name ?? '';
  const suffixName = suffixes[0]?.name ?? '';
  base.name = [prefixName, SLOT_NAMES[slot], suffixName].filter(Boolean).join(' ').trim();
  return base;
}
