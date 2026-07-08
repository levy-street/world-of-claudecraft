// Sprite manifest: maps every VISUALS key to its sprite sheet definition.
// Parallel to characters/manifest.ts but for 2D pixel-art billboard sprites.
// Pure data — no three.js, no loading.

import { preloadSpriteAtlas, preloadWeaponAtlas } from './atlas';
import { ITEM_WEAPON_VARIANTS } from '../../ui/weapon_variants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpriteDef {
  /** Base filename (without extension) under public/sprites/bodies/ */
  bodyPng: string;
  /** Optional weapon overlay filename under public/sprites/weapons/ */
  weaponPng?: string;
  /** World-unit height (pivot→crown) at e.scale = 1 — mirrors VisualDef.height */
  height: number;
  /** Floating offset above pivot (for elementals, ghosts) — mirrors VisualDef.hover */
  hover?: number;
  /** Material tint: explicit color, 'entity' (use e.color), or none — mirrors VisualDef.tint */
  tint?: number | 'entity';
  /** Tint strength (0..1) — mirrors VisualDef.tintStrength */
  tintStrength?: number;
}

// ---------------------------------------------------------------------------
// Weapon overlay offsets (relative to body pivot, in world units)
// ---------------------------------------------------------------------------

export interface WeaponOffset {
  bone: string;
  offsetX: number;
  offsetY: number;
  scale: number;
}

// Per-weapon-type default offsets (used when the weapon overlay is active).
// The actual hand position varies slightly per body, but these are close enough
// for the placeholder phase.
export const WEAPON_OFFSETS: Record<string, WeaponOffset> = {
  sword_1handed: { bone: 'handslot.r', offsetX: 0.32, offsetY: -0.1, scale: 0.55 },
  axe_1handed: { bone: 'handslot.r', offsetX: 0.3, offsetY: -0.12, scale: 0.5 },
  axe_2handed: { bone: 'handslot.r', offsetX: 0.35, offsetY: -0.15, scale: 0.65 },
  crossbow_1handed: { bone: 'handslot.r', offsetX: 0.28, offsetY: 0.0, scale: 0.5 },
  dagger: { bone: 'handslot.r', offsetX: 0.3, offsetY: -0.08, scale: 0.4 },
  staff: { bone: 'handslot.r', offsetX: 0.25, offsetY: 0.1, scale: 0.7 },
  wand: { bone: 'handslot.r', offsetX: 0.3, offsetY: -0.05, scale: 0.4 },
  spellbook_open: { bone: 'handslot.l', offsetX: -0.28, offsetY: -0.05, scale: 0.4 },
  skeleton_axe: { bone: 'handslot.r', offsetX: 0.3, offsetY: -0.12, scale: 0.5 },
  skeleton_blade: { bone: 'handslot.r', offsetX: 0.32, offsetY: -0.1, scale: 0.55 },
  skeleton_shield_large_a: { bone: 'handslot.l', offsetX: -0.28, offsetY: -0.1, scale: 0.5 },
  skeleton_staff: { bone: 'handslot.r', offsetX: 0.25, offsetY: 0.1, scale: 0.7 },
};

// ---------------------------------------------------------------------------
// Weapon variant → sprite sheet mapping
// Maps ITEM_WEAPON_VARIANTS values (weapon variant keys) to sprite filenames
// under public/sprites/weapons/. Used by SpriteVisual.setWeapon() to swap the
// weapon overlay texture at runtime when a player equips a new weapon.
// ---------------------------------------------------------------------------

export const WEAPON_SPRITE_MAP: Record<string, string> = {
  sword_a: 'sword_1handed',
  sword_b: 'sword_1handed',
  sword_c: 'sword_1handed',
  sword_d: 'sword_1handed',
  sword_e: 'sword_1handed',
  sword_f: 'sword_1handed',
  sword_g: 'sword_1handed',
  adv_sword_1handed: 'sword_1handed',
  adv_sword_2handed: 'sword_1handed',
  adv_sword_2handed_color: 'sword_1handed',
  dagger_a: 'dagger',
  dagger_b: 'dagger',
  dagger_c: 'dagger',
  adv_dagger: 'dagger',
  staff_a: 'staff',
  staff_b: 'staff',
  staff_c: 'staff',
  staff_d: 'staff',
  adv_staff: 'staff',
  adv_druid_staff: 'staff',
  wand_a: 'wand',
  wand_b: 'wand',
  adv_wand: 'wand',
  hammer_a: 'axe_1handed',
  hammer_b: 'axe_1handed',
  hammer_c: 'axe_1handed',
  hammer_d: 'axe_1handed',
  axe_a: 'axe_1handed',
  axe_b: 'axe_1handed',
  axe_c: 'axe_1handed',
  axe_d: 'axe_1handed',
  adv_axe_1handed: 'axe_1handed',
  adv_axe_2handed: 'axe_2handed',
  scythe: 'axe_2handed',
  spear_a: 'axe_1handed',
};

// Reverse lookup: given an item id, return the sprite filename (or null).
export function weaponSpriteForItem(itemId: string | null): string | null {
  if (!itemId) return null;
  const variantKey = ITEM_WEAPON_VARIANTS[itemId];
  if (!variantKey) return null;
  return WEAPON_SPRITE_MAP[variantKey] ?? null;
}

// ---------------------------------------------------------------------------
// Sprite definitions — one entry per VISUALS key
// ---------------------------------------------------------------------------

const SPRITE_DEFS: Record<string, SpriteDef> = {
  // -- player classes -------------------------------------------------------
  player_warrior: { bodyPng: 'knight', height: 2.6, weaponPng: 'sword_1handed' },
  player_paladin: { bodyPng: 'paladin', height: 2.6, weaponPng: 'axe_1handed' },
  player_hunter: { bodyPng: 'ranger', height: 2.6, weaponPng: 'crossbow_1handed' },
  player_rogue: { bodyPng: 'rogue', height: 2.6, weaponPng: 'dagger' },
  player_priest: { bodyPng: 'mage', height: 2.6, weaponPng: 'staff', tint: 0xf0e9d6, tintStrength: 0.5 },
  player_shaman: { bodyPng: 'barbarian', height: 2.6, weaponPng: 'axe_1handed', tint: 0x6f8fc9, tintStrength: 0.4 },
  player_mage: { bodyPng: 'mage', height: 2.6, weaponPng: 'staff' },
  player_warlock: { bodyPng: 'mage', height: 2.6, weaponPng: 'wand', tint: 0x8d5fd3, tintStrength: 0.45 },
  player_druid: { bodyPng: 'druid', height: 2.6, weaponPng: 'staff' },
  player_mech: { bodyPng: 'CombatMech', height: 2.6, weaponPng: 'sword_1handed' },

  // -- forms ----------------------------------------------------------------
  form_sheep: { bodyPng: 'alpaca', height: 1.2 },
  form_bear: { bodyPng: 'yetialt', height: 2.4, tint: 0x5a4030, tintStrength: 0.55 },
  form_cat: { bodyPng: 'wolf', height: 1.6, tint: 0xd08b45, tintStrength: 0.35 },
  form_travel: { bodyPng: 'chicken_cow', height: 2.3 },

  // -- creature mobs --------------------------------------------------------
  mob_wolf: { bodyPng: 'wolf', height: 1.6, tint: 'entity', tintStrength: 0.35 },
  mob_boar: { bodyPng: 'wild_boar', height: 1.45, tint: 'entity', tintStrength: 0.4 },
  mob_fox: { bodyPng: 'fox', height: 1.0, tint: 'entity', tintStrength: 0.35 },
  mob_critter: { bodyPng: 'fox', height: 0.7, tint: 'entity', tintStrength: 0.35 },
  mob_stag: { bodyPng: 'stag', height: 1.9, tint: 'entity', tintStrength: 0.35 },
  mob_spearjaw: { bodyPng: 'velociraptor', height: 1.8, tint: 'entity', tintStrength: 0.3 },
  mob_bear: { bodyPng: 'yetialt', height: 2.2, tint: 0x5a4030, tintStrength: 0.5 },
  mob_spider: { bodyPng: 'spider', height: 1.4, tint: 'entity', tintStrength: 0.35 },
  mob_murloc: { bodyPng: 'frog', height: 1.7, tint: 'entity', tintStrength: 0.45 },
  mob_kobold: { bodyPng: 'goblin', height: 2.1, tint: 'entity', tintStrength: 0.2 },
  mob_troll: { bodyPng: 'orc', height: 2.4, tint: 'entity', tintStrength: 0.12 },
  mob_ogre: { bodyPng: 'giant', height: 2.8, tint: 'entity', tintStrength: 0.2 },
  mob_elemental: { bodyPng: 'golelingevolved', height: 2.2, hover: 0.3, tint: 'entity', tintStrength: 0.4 },
  mob_dragonkin: { bodyPng: 'dragonevolved', height: 2.4, hover: 0.25, tint: 'entity', tintStrength: 0.2 },
  mob_choir_thrall: { bodyPng: 'ghost', height: 1.6, hover: 0.3, tint: 'entity', tintStrength: 0.6 },
  mob_tolling_bell: { bodyPng: 'tolling_bell', height: 3.4, tint: 'entity', tintStrength: 0.15 },
  mob_demon: { bodyPng: 'demonalt', height: 1.8, tint: 'entity', tintStrength: 0.5 },
  mob_demon_flying: { bodyPng: 'demon', height: 1.7, hover: 0.35, tint: 'entity', tintStrength: 0.25 },
  mob_demonalt: { bodyPng: 'demonalt', height: 2.1, tint: 'entity', tintStrength: 0.35 },

  // -- skeletons / undead ---------------------------------------------------
  skel_minion: { bodyPng: 'skeleton_minion', height: 2.5, tint: 'entity', tintStrength: 0.25 },
  skel_warrior: { bodyPng: 'skeleton_warrior', height: 2.5, tint: 'entity', tintStrength: 0.25 },
  skel_rogue: { bodyPng: 'skeleton_rogue', height: 2.5, tint: 'entity', tintStrength: 0.25 },
  skel_mage: { bodyPng: 'skeleton_mage', height: 2.5, weaponPng: 'skeleton_staff', tint: 'entity', tintStrength: 0.25 },
  skel_boss: { bodyPng: 'skeleton_mage', height: 2.5, weaponPng: 'skeleton_staff', tint: 'entity', tintStrength: 0.25 },
  skel_necromancer: { bodyPng: 'necromancer', height: 2.5, tint: 'entity', tintStrength: 0.25 },
  skel_golem: { bodyPng: 'skeleton_golem', height: 3.4, tint: 'entity', tintStrength: 0.25 },

  // -- humanoid mobs --------------------------------------------------------
  mob_bandit: { bodyPng: 'rogue_hooded', height: 2.6, weaponPng: 'dagger', tint: 0x6b3a32, tintStrength: 0.3 },
  mob_dark_caster: { bodyPng: 'mage', height: 2.6, weaponPng: 'staff', tint: 'entity', tintStrength: 0.5 },
  mob_bruiser: { bodyPng: 'barbarian', height: 2.6, weaponPng: 'axe_2handed', tint: 'entity', tintStrength: 0.3 },

  // -- delve-specific -------------------------------------------------------
  delve_skel_wraith: { bodyPng: 'skeleton_minion', height: 2.5, tint: 'entity', tintStrength: 0.55 },
  delve_skel_ringer: { bodyPng: 'skeleton_rogue', height: 2.5, weaponPng: 'skeleton_axe', tint: 'entity', tintStrength: 0.45 },
  delve_mob_acolyte: { bodyPng: 'mage', height: 2.6, weaponPng: 'staff', tint: 'entity', tintStrength: 0.6 },
  delve_skel_effigy: { bodyPng: 'skeleton_warrior', height: 2.5, weaponPng: 'skeleton_blade', tint: 'entity', tintStrength: 0.65 },
  delve_skel_varric: { bodyPng: 'skeleton_mage', height: 2.5, weaponPng: 'skeleton_staff', tint: 'entity', tintStrength: 0.35 },

  // -- NPCs -----------------------------------------------------------------
  npc_knight: { bodyPng: 'knight', height: 2.6, weaponPng: 'sword_1handed' },
  npc_mage: { bodyPng: 'mage', height: 2.6, weaponPng: 'staff', tint: 0xc9b98a, tintStrength: 0.3 },
  npc_aldric: { bodyPng: 'mage_classic', height: 2.6, tint: 0xc9b98a, tintStrength: 0.3 },
  npc_smith: { bodyPng: 'barbarian', height: 2.6, weaponPng: 'axe_1handed' },
  npc_scout: { bodyPng: 'rogue', height: 2.6, weaponPng: 'crossbow_1handed' },
  npc_villager: { bodyPng: 'rogue', height: 2.6, tint: 'entity', tintStrength: 0.35 },
  npc_villager_robed: { bodyPng: 'mage', height: 2.6, tint: 'entity', tintStrength: 0.35 },
  npc_reliquary_keeper: { bodyPng: 'paladin', height: 2.6 },
  npc_edda_reedhand: { bodyPng: 'druid', height: 2.6, weaponPng: 'staff' },

  // -- creature mobs (delve) ------------------------------------------------
  mob_reedbound_acolyte: { bodyPng: 'stone_cantor', height: 2.6, tint: 'entity', tintStrength: 0.2 },
  mob_spider_egg_sac: { bodyPng: 'spider_egg_sac', height: 1.8 },
};

export { SPRITE_DEFS };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SPRITES_DIR = 'sprites';
const BODIES_DIR = `${SPRITES_DIR}/bodies`;
const WEAPONS_DIR = `${SPRITES_DIR}/weapons`;

/** Resolve a sprite def's body PNG url (with extension). */
export function spriteBodyUrl(def: SpriteDef): string {
  return `${BODIES_DIR}/${def.bodyPng}.png`;
}

/** Resolve a sprite def's body JSON url. */
export function spriteBodyMetaUrl(def: SpriteDef): string {
  return `${BODIES_DIR}/${def.bodyPng}.json`;
}

/** Resolve a weapon sprite's PNG url. */
export function spriteWeaponUrl(weaponPng: string): string {
  return `${WEAPONS_DIR}/${weaponPng}.png`;
}

/** Resolve a weapon sprite's JSON url. */
export function spriteWeaponMetaUrl(weaponPng: string): string {
  return `${WEAPONS_DIR}/${weaponPng}.json`;
}

// ---------------------------------------------------------------------------
// Preload sweep — called at import time to kick off all sprite fetches
// ---------------------------------------------------------------------------

const _preloaded = new Set<string>();
const _weaponPreloaded = new Set<string>();

export function registerSpritePreloads(): void {
  for (const [, def] of Object.entries(SPRITE_DEFS)) {
    // body
    if (!_preloaded.has(def.bodyPng)) {
      _preloaded.add(def.bodyPng);
      preloadSpriteAtlas(spriteBodyUrl(def), spriteBodyMetaUrl(def));
    }
    // weapon (entity default)
    if (def.weaponPng && !_weaponPreloaded.has(def.weaponPng)) {
      _weaponPreloaded.add(def.weaponPng);
      preloadWeaponAtlas(spriteWeaponUrl(def.weaponPng), spriteWeaponMetaUrl(def.weaponPng));
    }
  }
  // Also preload ALL weapon sprite sheets from WEAPON_SPRITE_MAP so runtime
  // weapon swaps don't flash a missing texture on first equip.
  for (const spriteName of new Set(Object.values(WEAPON_SPRITE_MAP))) {
    if (!_weaponPreloaded.has(spriteName)) {
      _weaponPreloaded.add(spriteName);
      preloadWeaponAtlas(spriteWeaponUrl(spriteName), spriteWeaponMetaUrl(spriteName));
    }
  }
}

// Kick off at import time (same pattern as characters/assets.ts)
registerSpritePreloads();
