// Weapon-type classification for every equippable weapon item, plus the rule for
// which Season 1 Armory skin types a player may apply. A skin only attaches while
// a weapon of its type is equipped; the server enforces this, the offline Sim
// mirrors it, and the store UI reads it to enable or disable the Apply button.
//
// Every kind:'weapon' item in the merged ITEMS table must classify here (guarded
// by tests/weapon_skins.test.ts). Heroic variants reuse their base row via the
// heroic_ prefix strip. 'polearm' exists so spears and scythes classify honestly;
// no skins target it.

import { ITEMS } from '../data';
import { canEquipItem } from '../equipment_rules';
import type { PlayerClass, WeaponSkinLoadout, WeaponSkinType } from '../types';
import { WEAPON_SKINS } from './weapon_skins';

export type ItemWeaponType = WeaponSkinType | 'polearm';

export const WEAPON_TYPE_BY_ITEM: Record<string, ItemWeaponType> = {
  // Swords
  worn_sword: 'sword',
  redbrook_blade: 'sword',
  valeborn_spellblade: 'sword',
  eastbrook_arming_sword: 'sword',
  eastbrook_greatsword: 'sword',
  gravecaller_blade: 'sword',
  verlans_oathblade: 'sword',
  maldrecs_soulbinder: 'sword',
  crossroads_saber: 'sword',
  mistcallers_edge: 'sword',
  zealotsbane_blade: 'sword',
  emberfang_warblade: 'sword',
  wyrmfang_greatblade: 'sword',
  kingsbane_last_oath: 'sword',
  highwatch_warblade: 'sword',
  highwatch_greatsword: 'sword',
  moonscale_saber: 'sword',
  deathless_greatblade: 'sword',
  final_argument_greatblade: 'sword',
  bonewrought_greatsword: 'sword',
  direfang_greatblade: 'sword',
  // Daggers
  rusty_dagger: 'dagger',
  keen_dirk: 'dagger',
  moggers_shiv: 'dagger',
  vale_carving_knife: 'dagger',
  widowfang_dirk: 'dagger',
  gravewardens_shiv: 'dagger',
  caravan_warden_dirk: 'dagger',
  mistbinder_kris: 'dagger',
  mirejaw_biteblade: 'dagger',
  sloomtooth_tidefang: 'dagger',
  nhalias_dirgeblade: 'dagger',
  riptide_dirk: 'dagger',
  mirefen_skinner: 'dagger',
  cultist_flayer: 'dagger',
  ironvein_pickblade: 'dagger',
  skullsplitter_dirk: 'dagger',
  gutripper_shiv: 'dagger',
  fang_of_korzul: 'dagger',
  icevein_dirk: 'dagger',
  tideglass_dirk: 'dagger',
  drownedmoon_kris: 'dagger',
  mirejaw_fang_knife: 'dagger',
  drowned_choir_fang: 'dagger',
  mistcallers_fang: 'dagger',
  first_blood_razor: 'dagger',
  // Maces
  training_mace: 'mace',
  bristleback_maul: 'mace',
  moggers_copper_cudgel: 'mace',
  bronzework_mace: 'mace',
  voss_sanctified_mace: 'mace',
  bogiron_mace: 'mace',
  brutoks_maul: 'mace',
  crag_warden_cudgel: 'mace',
  drownedmoon_maul: 'mace',
  nhalias_bell_maul: 'mace',
  // Axes
  rusty_hatchet: 'axe',
  gorraks_cruel_chopper: 'axe',
  tunnelkings_spade: 'axe',
  gorraks_cleaver: 'axe',
  tradesman_hatchet: 'axe',
  deacons_cleaver: 'axe',
  drogmars_skullcleaver: 'axe',
  gravewyrm_cleaver: 'axe',
  // Staves
  gnarled_staff: 'staff',
  apprentice_staff: 'staff',
  hickory_shortstaff: 'staff',
  gravecaller_staff: 'staff',
  hollow_vigil_staff: 'staff',
  drovers_staff: 'staff',
  staff_of_drowned_prayers: 'staff',
  mirejaw_oracle_staff: 'staff',
  vaels_mist_staff: 'staff',
  fenreed_staff: 'staff',
  emberwood_staff: 'staff',
  ironvein_lantern_staff: 'staff',
  ogre_bonecharm_staff: 'staff',
  staff_of_velkhar: 'staff',
  staff_of_the_gravewyrm: 'staff',
  deathless_heartwood: 'staff',
  craghorn_staff: 'staff',
  lunar_tide_greatstaff: 'staff',
  emberglass_warstaff: 'staff',
  // Wands
  drowned_tide_scepter: 'wand',
  palecoil_rod: 'wand',
  drownedmoon_scepter: 'wand',
  corpse_candle_focus: 'wand',
  nhalias_litany_rod: 'wand',
  scepter_of_the_deathless_court: 'wand',
  stormcallers_focus: 'wand',
  // Polearms (no skins target these)
  tidereaver_gaff: 'polearm',
  fen_reaver_glaive: 'polearm',
};

/**
 * Weapon type for an item id; heroic variants (heroic_<base>) resolve through
 * their base row. Null for non-weapons and unclassified ids.
 */
export function weaponTypeForItem(itemId: string | null | undefined): ItemWeaponType | null {
  if (!itemId) return null;
  const direct = WEAPON_TYPE_BY_ITEM[itemId];
  if (direct) return direct;
  if (itemId.startsWith('heroic_')) {
    return WEAPON_TYPE_BY_ITEM[itemId.slice('heroic_'.length)] ?? null;
  }
  return null;
}

/**
 * Skin types the player may apply right now. Requires an equipped mainhand
 * weapon. Hunters always display the class ranged weapon regardless of the
 * equipped item, so they may apply bow and crossbow skins; every other class
 * displays the equipped item, so the skin must match that item's type.
 */
export function skinnableWeaponTypesFor(
  cls: string,
  mainhandItemId: string | null | undefined,
): WeaponSkinType[] {
  if (!mainhandItemId) return [];
  // Crossbow first: it is the hunter's native visual, so with both types in the
  // loadout the crossbow skin wins resolution deterministically.
  if (cls === 'hunter') return ['crossbow', 'bow'];
  const t = weaponTypeForItem(mainhandItemId);
  if (!t || t === 'polearm') return [];
  return [t];
}

/**
 * The skin the player's held weapon should show right now: the first loadout
 * entry whose weapon type is applicable to the equipped mainhand (and whose
 * skin still targets that type), or null. Pure; both hosts and the renderer
 * preview rely on this exact resolution.
 */
export function resolveActiveWeaponSkin(
  cls: string,
  mainhandItemId: string | null | undefined,
  loadout: WeaponSkinLoadout | null | undefined,
): string | null {
  if (!loadout) return null;
  for (const t of skinnableWeaponTypesFor(cls, mainhandItemId)) {
    const skinId = loadout[t];
    if (skinId && WEAPON_SKINS[skinId]?.weaponType === t) return skinId;
  }
  return null;
}

/** True when `skinType` may be applied with the given class and mainhand item. */
export function weaponSkinTypeMatches(
  cls: string,
  mainhandItemId: string | null | undefined,
  skinType: WeaponSkinType,
): boolean {
  return skinnableWeaponTypesFor(cls, mainhandItemId).includes(skinType);
}

/**
 * Return a validated loadout with `skinId` applied. Bow and crossbow occupy the
 * same hunter ranged-weapon display slot, so applying either one removes the
 * other. Other weapon types remain parked independently for gear swaps.
 */
export function withWeaponSkinApplied(
  loadout: WeaponSkinLoadout | null | undefined,
  skinId: string,
): WeaponSkinLoadout | null {
  const def = WEAPON_SKINS[skinId];
  if (!def) return null;
  const next = { ...(loadout ?? {}) };
  if (def.weaponType === 'bow') delete next.crossbow;
  else if (def.weaponType === 'crossbow') delete next.bow;
  next[def.weaponType] = skinId;
  return next;
}

// Canonical class display order for the eligibility chips (the PlayerClass
// union order in ../types.ts).
const CLASS_ORDER: readonly PlayerClass[] = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
];

const eligibleByType = new Map<WeaponSkinType, readonly PlayerClass[]>();

/**
 * Every class that can ever APPLY a skin of this weapon type (the store card
 * eligibility chips). Hunters always display the class ranged weapon, so bow
 * and crossbow are hunter-only and hunters are never eligible for any other
 * type. Other types derive from the item data: a class is eligible when it can
 * equip a proficiency-locked weapon of the type (starter weapons carry no
 * class lock and would mark every type all-class, so locked rows decide; a
 * type with no locked rows falls back to the full equip check). Memoized: the
 * item data is static content.
 */
export function eligibleClassesForWeaponSkinType(type: WeaponSkinType): readonly PlayerClass[] {
  const memo = eligibleByType.get(type);
  if (memo) return memo;
  let out: readonly PlayerClass[];
  if (type === 'bow' || type === 'crossbow') {
    out = ['hunter'];
  } else {
    const items = Object.keys(WEAPON_TYPE_BY_ITEM)
      .filter((id) => WEAPON_TYPE_BY_ITEM[id] === type)
      .flatMap((id) => (ITEMS[id] ? [ITEMS[id]] : []));
    const locked = items.filter((item) => item.requiredClass);
    const pool = locked.length ? locked : items;
    out = CLASS_ORDER.filter(
      (cls) => cls !== 'hunter' && pool.some((item) => canEquipItem(cls, item)),
    );
  }
  eligibleByType.set(type, out);
  return out;
}
