// Buried Hoard boss loot: four thematic pieces per hoard boss, tradable (never
// soulbound), covering every armour class and both jewellery slots. No weapons
// (a weapon needs a held model and painted art) and no trinkets.
//
// One PIECE, three tiers, by the map that led to the hoard:
//
//   map         item level   quality   stands beside
//   rare            28        rare      the PvP Warfare tier
//   epic            31        epic      heroic five-mans and rift epics
//   legendary       33        epic      beside the first heroic raid tier,
//                                       below Crucible of Ignivar (35)
//
// A legendary map is the hardest thing the treasure maps offer (one map in a
// hundred, or days of reputation currency poured into Cartographer's Ink), which
// is what buys it a piece above everything outside a raid.
//
// NOTHING here is a hand-picked stat number. A piece is authored as a PROFILE
// (which stats, in what proportion) and each tier's stats are derived from the
// game's own budget: primaryStatBudget for the line, normalizeToStaminaModel for
// the stamina floor. Armour, shield and rating values follow the shipped
// precedent at the same item level (see the tables below), never extrapolating
// past it. tests/hoard_loot.test.ts pins all of that. A piece carries primary
// stats and ONE rating, nothing else: no spell power or healing line, no proc, no
// set. The hoard pays breadth (every slot, every class, tradable), and the raids
// keep the affixes.
//
// Every tier is its own item with its own NAME and art: the game forbids two
// enchantable items reading the same (tests/enchant_apply_view.test.ts), and a
// player pricing one on the market must be able to tell the tiers apart at a
// glance. The names tell the treasure's story: what a rare map digs up has lain
// TARNISHED in the ground, an epic map's piece is the piece itself, and the
// legendary map (the Sovereign Treasure Map) leads to the SOVEREIGN one the
// keeper kept for itself. Not "Gilded": that word already names the EPIC map.
//
// Host-agnostic data-as-code leaf: no rng state, no DOM.

import {
  normalizeToStaminaModel,
  primaryStatBudget,
  QUALITY_ILVL_BONUS,
  slotStatMultForItem,
} from '../item_budget';
import type { ArmorType, CoreStats, ItemDef, PlayerClass } from '../types';
import type { TreasureMapRarity } from './treasure_maps';

type RatingKey = 'hitRating' | 'critRating' | 'hasteRating';
type PieceSlot =
  | 'helmet'
  | 'shoulder'
  | 'chest'
  | 'waist'
  | 'legs'
  | 'gloves'
  | 'feet'
  | 'neck'
  | 'ring'
  | 'offhand';

/** The tier a hoard pays, by the rarity of the map. A common map has no tier of
 *  its own: it rolls the rare tier, at a low chance. */
export type HoardLootTier = 'rare' | 'epic' | 'legendary';
/** Build order: the epic tier first, because it owns the plain id. */
export const HOARD_LOOT_TIER_ORDER: readonly HoardLootTier[] = ['epic', 'rare', 'legendary'];

interface TierSpec {
  quality: 'rare' | 'epic';
  /** item_level.ts source level; item level is this plus the quality bonus. */
  sourceLevel: number;
  /** Rating allowance: worn armour, jewellery, anything held in the off hand. */
  armorRating: number;
  jewelryRating: number;
  offhandRating: number;
  sellMult: number;
  /** How the tier reads in the item's English name. */
  name: (base: string) => string;
}

/** Ratings follow the game's rating ladder (tests/combat_rating.test.ts): an
 *  ilvl-28 rare carries none, every ilvl-31 piece carries exactly 20, and the
 *  ilvl-33 rung keeps the ilvl-31 allowance (40 on armour, 25 on jewellery, 20
 *  held in the off hand): two ratings on one piece stays the raid tier's
 *  identity. */
export const HOARD_LOOT_TIERS: Readonly<Record<HoardLootTier, TierSpec>> = Object.freeze({
  rare: {
    quality: 'rare',
    sourceLevel: 25,
    armorRating: 0,
    jewelryRating: 0,
    offhandRating: 0,
    sellMult: 0.45,
    name: (base) => `Tarnished ${base}`,
  },
  epic: {
    quality: 'epic',
    sourceLevel: 25,
    armorRating: 20,
    jewelryRating: 20,
    offhandRating: 20,
    sellMult: 1,
    name: (base) => base,
  },
  legendary: {
    quality: 'epic',
    sourceLevel: 27,
    armorRating: 40,
    jewelryRating: 25,
    offhandRating: 20,
    sellMult: 1.4,
    name: (base) => `Sovereign ${base}`,
  },
});

export function hoardLootItemLevel(tier: HoardLootTier): number {
  const spec = HOARD_LOOT_TIERS[tier];
  return spec.sourceLevel + (QUALITY_ILVL_BONUS[spec.quality] ?? 0);
}

export function hoardLootTierForMap(rarity: TreasureMapRarity): HoardLootTier {
  return rarity === 'legendary' ? 'legendary' : rarity === 'epic' ? 'epic' : 'rare';
}

/** Armour per item level, by armour class and slot: the median of every shipped
 *  piece of that class and slot between item level 24 and 36. A hoard piece sits
 *  exactly on the curve the game already draws; tests/hoard_loot.test.ts
 *  re-derives every median from the live catalog, so the table cannot rot. */
export const HOARD_ARMOR_PER_ILVL: Readonly<Record<ArmorType, Partial<Record<PieceSlot, number>>>> =
  {
    cloth: {
      chest: 3.0,
      feet: 2.0,
      gloves: 2.14,
      helmet: 2.57,
      legs: 2.71,
      shoulder: 2.29,
      waist: 2.14,
    },
    leather: {
      chest: 6.14,
      feet: 4.14,
      gloves: 4.29,
      helmet: 5.29,
      legs: 5.57,
      shoulder: 4.71,
      waist: 4.29,
    },
    mail: {
      chest: 10.86,
      feet: 7.06,
      gloves: 7.47,
      helmet: 9.29,
      legs: 9.86,
      shoulder: 8.29,
      waist: 7.4,
    },
  };

/** Shields: every shipped epic shield from item level 29 to 33 is 680 armour and
 *  30 block. Below that reference the values scale down with item level; above
 *  it they hold, never past the reference. */
export const HOARD_SHIELD_REFERENCE = { itemLevel: 29, armor: 680, block: 30 } as const;

const HEAVY: PlayerClass[] = ['warrior', 'paladin'];
// A shield's class list is its WHOLE equip rule (equipment_rules.ts canEquipItem),
// so the tank shield names every shield class, as every shipped epic shield does.
const SHIELD_TANK: PlayerClass[] = ['warrior', 'paladin', 'shaman'];
const HEAVY_CASTER: PlayerClass[] = ['shaman', 'paladin'];
const LEATHER_AGILE: PlayerClass[] = ['rogue', 'druid', 'hunter'];
const LEATHER_FERAL: PlayerClass[] = ['rogue', 'druid'];
const LEATHER_HEALER: PlayerClass[] = ['druid'];
const CLOTH: PlayerClass[] = ['mage', 'priest', 'warlock'];
const ORB: PlayerClass[] = ['mage', 'priest', 'warlock', 'druid'];
const CHALICE: PlayerClass[] = ['priest', 'shaman', 'druid', 'paladin', 'mage', 'warlock'];

interface HoardPiece {
  id: string;
  name: string;
  slot: PieceSlot;
  /** Absent on jewellery and on the caster off hands. */
  armorType?: ArmorType;
  shield?: true;
  /** Stat identity as a ratio; the tier's budget decides the actual points. */
  profile: Partial<CoreStats>;
  rating: RatingKey;
  requiredClass?: PlayerClass[];
  /** Vendor value of the epic tier, copper. */
  sellValue: number;
}

// biome-ignore format: one piece per line reads as the loot table it is
const PIECES: readonly HoardPiece[] = [
  // --- Archon Nyxaris (arcane, void) ---
  { id: 'collapsar_band_of_nyxaris', name: 'Collapsar Band of Nyxaris', slot: 'ring', profile: { int: 8, sta: 5 }, rating: 'hasteRating', sellValue: 11000 },
  { id: 'orb_collapsing_void', name: 'Orb of Collapsing Void', slot: 'offhand', profile: { int: 9, spi: 6, sta: 4 }, rating: 'hasteRating', requiredClass: ORB, sellValue: 11000 },
  { id: 'cowl_of_event_horizon', name: 'Cowl of the Event Horizon', slot: 'helmet', armorType: 'cloth', profile: { int: 17, sta: 11 }, rating: 'hitRating', requiredClass: CLOTH, sellValue: 12000 },
  { id: 'mantle_of_singularity', name: 'Mantle of Singularity', slot: 'shoulder', armorType: 'cloth', profile: { int: 13, sta: 8 }, rating: 'hasteRating', requiredClass: CLOTH, sellValue: 12000 },
  // --- Hoarfrost Warden (frost) ---
  { id: 'glacier_hewn_bulwark', name: 'Glacier-Hewn Bulwark', slot: 'offhand', armorType: 'mail', shield: true, profile: { sta: 10, str: 5 }, rating: 'hitRating', requiredClass: SHIELD_TANK, sellValue: 13000 },
  { id: 'permafrost_legguards', name: 'Permafrost Legguards', slot: 'legs', armorType: 'mail', profile: { str: 17, sta: 11 }, rating: 'critRating', requiredClass: HEAVY, sellValue: 14000 },
  { id: 'frostbitten_rime_slippers', name: 'Frostbitten Rime Slippers', slot: 'feet', armorType: 'cloth', profile: { int: 13, sta: 8 }, rating: 'critRating', requiredClass: CLOTH, sellValue: 11000 },
  { id: 'rime_crusted_grips', name: 'Rime-Crusted Grips', slot: 'gloves', armorType: 'leather', profile: { agi: 10, sta: 7 }, rating: 'hitRating', requiredClass: LEATHER_AGILE, sellValue: 11000 },
  // --- Emberforge Tyrant (fire, forge) ---
  { id: 'ember_wrought_crown', name: 'Ember-Wrought Crown', slot: 'helmet', armorType: 'mail', profile: { str: 17, sta: 11 }, rating: 'critRating', requiredClass: HEAVY, sellValue: 13000 },
  { id: 'cinder_stitched_robes', name: 'Cinder-Stitched Robes', slot: 'chest', armorType: 'cloth', profile: { int: 17, sta: 11 }, rating: 'critRating', requiredClass: CLOTH, sellValue: 14000 },
  { id: 'chained_ember_choker', name: 'Chained Ember Choker', slot: 'neck', profile: { str: 8, sta: 5 }, rating: 'critRating', sellValue: 11000 },
  { id: 'molten_clinker_girdle', name: 'Molten Clinker Girdle', slot: 'waist', armorType: 'mail', profile: { str: 13, sta: 8 }, rating: 'hitRating', requiredClass: HEAVY, sellValue: 11000 },
  // --- Tempest Vharok (storm) ---
  { id: 'storm_tuned_buckler', name: 'Storm-Tuned Buckler', slot: 'offhand', armorType: 'mail', shield: true, profile: { int: 8, spi: 7, sta: 5 }, rating: 'hasteRating', requiredClass: HEAVY_CASTER, sellValue: 13000 },
  { id: 'hauberk_tempest_gale', name: 'Hauberk of the Tempest Gale', slot: 'chest', armorType: 'mail', profile: { int: 13, spi: 8 }, rating: 'hasteRating', requiredClass: HEAVY_CASTER, sellValue: 14000 },
  { id: 'gale_strider_boots', name: 'Gale-Strider Boots', slot: 'feet', armorType: 'leather', profile: { agi: 13, sta: 8 }, rating: 'critRating', requiredClass: LEATHER_AGILE, sellValue: 11000 },
  { id: 'tempest_strike_grips', name: 'Tempest-Strike Grips', slot: 'gloves', armorType: 'mail', profile: { int: 13, spi: 8 }, rating: 'hasteRating', requiredClass: HEAVY_CASTER, sellValue: 11000 },
  // --- Warlord Grask (physical, brute) ---
  { id: 'breastplate_tectonic_might', name: 'Breastplate of Tectonic Might', slot: 'chest', armorType: 'mail', profile: { str: 17, sta: 13 }, rating: 'hitRating', requiredClass: HEAVY, sellValue: 14000 },
  { id: 'band_mountains_weight', name: "Band of the Mountain's Weight", slot: 'ring', profile: { sta: 13, str: 4 }, rating: 'hitRating', sellValue: 11000 },
  { id: 'monolithic_shoulderguards', name: 'Monolithic Shoulderguards', slot: 'shoulder', armorType: 'leather', profile: { agi: 11, sta: 9 }, rating: 'hitRating', requiredClass: LEATHER_FERAL, sellValue: 12000 },
  { id: 'earthshaker_warboots', name: 'Earthshaker Warboots', slot: 'feet', armorType: 'mail', profile: { str: 13, sta: 9 }, rating: 'hitRating', requiredClass: HEAVY, sellValue: 11000 },
  // --- Broodmother Vysska (venom) ---
  { id: 'silkstalker_woven_vest', name: 'Woven Vest of the Silkstalker', slot: 'chest', armorType: 'leather', profile: { agi: 17, sta: 11 }, rating: 'critRating', requiredClass: LEATHER_AGILE, sellValue: 14000 },
  { id: 'spun_venom_spaulders', name: 'Spun-Venom Spaulders', slot: 'shoulder', armorType: 'leather', profile: { int: 13, spi: 8 }, rating: 'hasteRating', requiredClass: LEATHER_HEALER, sellValue: 12000 },
  { id: 'broodmother_chitin_cowl', name: 'Chitin Cowl of the Broodmother', slot: 'helmet', armorType: 'leather', profile: { agi: 17, sta: 11 }, rating: 'hitRating', requiredClass: LEATHER_AGILE, sellValue: 13000 },
  { id: 'venom_etched_waistcord', name: 'Venom-Etched Waistcord', slot: 'waist', armorType: 'cloth', profile: { int: 13, sta: 8 }, rating: 'hasteRating', requiredClass: CLOTH, sellValue: 11000 },
  // --- the bone legion (necromancy) ---
  { id: 'bone_studded_pauldrons', name: 'Bone-Studded Pauldrons', slot: 'shoulder', armorType: 'mail', profile: { str: 13, sta: 8 }, rating: 'hitRating', requiredClass: HEAVY, sellValue: 12000 },
  { id: 'legguards_of_the_ossuary', name: 'Legguards of the Ossuary', slot: 'legs', armorType: 'leather', profile: { agi: 17, sta: 11 }, rating: 'hasteRating', requiredClass: LEATHER_FERAL, sellValue: 14000 },
  { id: 'seal_of_the_cryptwalker', name: 'Seal of the Cryptwalker', slot: 'ring', profile: { int: 8, sta: 4 }, rating: 'critRating', sellValue: 11000 },
  { id: 'ossuary_bone_crown', name: 'Ossuary Bone Crown', slot: 'helmet', armorType: 'cloth', profile: { int: 17, sta: 11 }, rating: 'critRating', requiredClass: CLOTH, sellValue: 13000 },
  // --- the tide (water) ---
  { id: 'chalice_of_living_tides', name: 'Chalice of the Living Tides', slot: 'offhand', profile: { int: 9, spi: 6, sta: 4 }, rating: 'hasteRating', requiredClass: CHALICE, sellValue: 11000 },
  { id: 'pendant_continuous_flow', name: 'Pendant of Continuous Flow', slot: 'neck', profile: { int: 8, spi: 5 }, rating: 'hasteRating', sellValue: 11000 },
  { id: 'coral_encrusted_girdle', name: 'Coral-Encrusted Girdle', slot: 'waist', armorType: 'mail', profile: { int: 13, spi: 8, sta: 5 }, rating: 'hasteRating', requiredClass: HEAVY_CASTER, sellValue: 11000 },
  { id: 'riptide_handwraps', name: 'Riptide Handwraps', slot: 'gloves', armorType: 'leather', profile: { agi: 10, sta: 7 }, rating: 'critRating', requiredClass: LEATHER_AGILE, sellValue: 11000 },
];

/** Which pieces each hoard boss can drop: four apiece, in PIECES order. */
const BOSS_ORDER = [
  'rift_boss_arcane',
  'rift_boss_frost',
  'rift_boss_ember',
  'rift_boss_storm',
  'rift_boss_brute',
  'rift_boss_venom',
  'rift_boss_necro',
  'rift_boss_tide',
] as const;
export const HOARD_PIECES_PER_BOSS = 4;
export const HOARD_BOSS_LOOT_TABLES: Readonly<Record<string, readonly string[]>> = Object.freeze(
  Object.fromEntries(
    BOSS_ORDER.map((boss, index) => [
      boss,
      PIECES.slice(index * HOARD_PIECES_PER_BOSS, (index + 1) * HOARD_PIECES_PER_BOSS).map(
        (piece) => piece.id,
      ),
    ]),
  ),
);

/** The plain id is the epic tier; the other two carry their tier as a prefix. */
export function hoardLootVariantId(baseId: string, tier: HoardLootTier): string {
  return tier === 'epic' ? baseId : `${tier}_${baseId}`;
}

function buildPiece(piece: HoardPiece, tier: HoardLootTier): ItemDef {
  const spec = HOARD_LOOT_TIERS[tier];
  const itemLevel = hoardLootItemLevel(tier);
  const held = piece.slot === 'offhand' && !piece.shield;
  const jewelry = piece.slot === 'neck' || piece.slot === 'ring';
  const shell = {
    id: hoardLootVariantId(piece.id, tier),
    name: spec.name(piece.name),
    slot: piece.slot,
    quality: spec.quality,
    requiredLevel: 20,
    sellValue: Math.round(piece.sellValue * spec.sellMult),
    ...(piece.requiredClass ? { requiredClass: [...piece.requiredClass] } : {}),
    // The Reliquary keeps one slot per PIECE (the plain id): the other two tiers
    // discover it, so any tier fills the slot.
    ...(tier === 'epic' ? {} : { relicOf: piece.id }),
  };
  const draft = (
    held
      ? { ...shell, kind: 'held_offhand' }
      : {
          ...shell,
          kind: 'armor',
          ...(piece.armorType ? { armorType: piece.armorType } : {}),
          ...(piece.shield ? { shield: true } : {}),
        }
  ) as ItemDef;
  const budget = primaryStatBudget(itemLevel, spec.quality, piece.slot, slotStatMultForItem(draft));
  const stats: Partial<CoreStats> = normalizeToStaminaModel(piece.profile, budget);
  if (piece.shield) {
    const scale = Math.min(1, itemLevel / HOARD_SHIELD_REFERENCE.itemLevel);
    stats.armor = Math.round(HOARD_SHIELD_REFERENCE.armor * scale);
    (draft as { blockValue?: number }).blockValue = Math.round(
      HOARD_SHIELD_REFERENCE.block * scale,
    );
  } else if (piece.armorType) {
    const perLevel = HOARD_ARMOR_PER_ILVL[piece.armorType][piece.slot] ?? 0;
    stats.armor = Math.round(perLevel * itemLevel);
  }
  draft.stats = stats;
  const rating = jewelry
    ? spec.jewelryRating
    : piece.slot === 'offhand'
      ? spec.offhandRating
      : spec.armorRating;
  if (rating > 0) draft[piece.rating] = rating;
  return draft;
}

/** The 32 pieces, by their plain (epic tier) id. */
export const HOARD_BASE_ITEM_IDS: readonly string[] = PIECES.map((piece) => piece.id);

/** Every tier of every piece, keyed by item id, for the ITEMS merge in data.ts. */
export const HOARD_ITEMS: Record<string, ItemDef> = Object.fromEntries(
  PIECES.flatMap((piece) =>
    HOARD_LOOT_TIER_ORDER.map((tier) => {
      const item = buildPiece(piece, tier);
      return [item.id, item] as const;
    }),
  ),
);

/** item_level.ts source levels for every generated id. */
export function hoardLootSourceLevels(): Array<{ id: string; sourceLevel: number }> {
  return PIECES.flatMap((piece) =>
    HOARD_LOOT_TIER_ORDER.map((tier) => ({
      id: hoardLootVariantId(piece.id, tier),
      sourceLevel: HOARD_LOOT_TIERS[tier].sourceLevel,
    })),
  );
}

/** Share of rolls that prefer a piece AIMED at the looter's class (its
 *  requiredClass list, which on armour is loot targeting, not the equip rule: a
 *  warrior can wear cloth, and is never offered it first). The rest roll
 *  the boss's whole table: the pieces are tradable, so an off-class drop still
 *  has a buyer, and the market sees every piece. */
export const HOARD_LOOT_CLASS_BIAS = 0.7;

/** One piece from the fallen boss's table, at the map's tier. Always the same two
 *  rng draws in the same order, whatever the looter's class. */
export function rollHoardBossDrop(
  rng: { int: (min: number, max: number) => number; chance: (p: number) => boolean },
  bossTemplateId: string | undefined,
  rarity: TreasureMapRarity,
  playerClass?: PlayerClass,
): string {
  // A boss with no table of its own (a future hoard keeper) pays from every
  // table rather than from nothing.
  const table: readonly string[] =
    (bossTemplateId ? HOARD_BOSS_LOOT_TABLES[bossTemplateId] : undefined) ?? HOARD_BASE_ITEM_IDS;
  const usable = playerClass
    ? table.filter((id) => {
        const allowed = HOARD_ITEMS[id]?.requiredClass;
        return !allowed || allowed.includes(playerClass);
      })
    : [];
  // Drawn unconditionally, so the rng sequence never depends on the class.
  const biased = rng.chance(HOARD_LOOT_CLASS_BIAS);
  const candidates = biased && usable.length > 0 ? usable : table;
  const baseId = candidates[rng.int(0, candidates.length - 1)];
  return hoardLootVariantId(baseId, hoardLootTierForMap(rarity));
}
