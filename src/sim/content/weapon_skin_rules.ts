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
import type { PlayerClass, SkinCatalog, WeaponSkinLoadout, WeaponSkinType } from '../types';
import { WEAPON_SKINS } from './weapon_skins';

export type ItemWeaponType = WeaponSkinType | 'polearm';

export const WEAPON_TYPE_BY_ITEM: Record<string, ItemWeaponType> = {
  // Swords
  worn_sword: 'sword',
  ironedge_longsword: 'sword',
  thorium_warblade: 'sword',
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
  veilsteel_blade: 'sword',
  bonewrought_greatsword: 'sword',
  direfang_greatblade: 'sword',
  hoarfrost_edge: 'sword',
  wildheart_tuskblade: 'sword',
  greatfang_of_the_basin: 'sword',
  // Daggers
  rusty_dagger: 'dagger',
  whetted_iron_dirk: 'dagger',
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
  rimefang: 'dagger',
  marrowpoint: 'dagger',
  duskwhisper: 'dagger',
  boneglass_shiv: 'dagger',
  icevein_dirk: 'dagger',
  tideglass_dirk: 'dagger',
  drownedmoon_kris: 'dagger',
  mirejaw_fang_knife: 'dagger',
  drowned_choir_fang: 'dagger',
  mistcallers_fang: 'dagger',
  first_blood_razor: 'dagger',
  duskfang_dirk: 'dagger',
  wildheart_fangknife: 'dagger',
  voidsong_dirk: 'dagger',
  // Maces
  training_mace: 'mace',
  copper_flanged_mace: 'mace',
  ironshod_maul: 'mace',
  bristleback_maul: 'mace',
  moggers_copper_cudgel: 'mace',
  bronzework_mace: 'mace',
  voss_sanctified_mace: 'mace',
  bogiron_mace: 'mace',
  brutoks_maul: 'mace',
  crag_warden_cudgel: 'mace',
  drownedmoon_maul: 'mace',
  nhalias_bell_maul: 'mace',
  fenshadow_maul: 'mace',
  gravewyrm_thornmaul: 'mace',
  maul_of_the_scourged_wilds: 'mace',
  wildsoul_maul: 'mace',
  varkhul_forgebreaker: 'mace',
  // Axes
  rusty_hatchet: 'axe',
  copper_bearded_axe: 'axe',
  arcanite_war_axe: 'axe',
  gorraks_cruel_chopper: 'axe',
  tunnelkings_spade: 'axe',
  gorraks_cleaver: 'axe',
  tradesman_hatchet: 'axe',
  deacons_cleaver: 'axe',
  drogmars_skullcleaver: 'axe',
  gravewyrm_cleaver: 'axe',
  pitlords_cleaver: 'axe',
  // Staves
  gnarled_staff: 'staff',
  elderwood_battle_staff: 'staff',
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
  briarroot_staff: 'staff',
  cragthorn_greatstaff: 'staff',
  nightfangs_greatstaff: 'staff',
  gleamwood_stave: 'staff',
  wildheart_hexwood_staff: 'staff',
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
  ironbark_boar_spear: 'polearm',
  fen_reaver_glaive: 'polearm',
  fanglords_beastspear: 'polearm',
  // Crucible of the Last Spring raid weapons (content/ignivar_loot.ts).
  forgefathers_warhammer: 'mace',
  springtouched_crozier: 'mace',
  cinderfang_kris: 'dagger',
  slagrender_cleaver: 'axe',
  anvilguard_blade: 'sword',
  heart_of_the_end_greatblade: 'sword',
  staff_of_the_last_spring: 'staff',
  forgefire_spire: 'staff',
  wand_of_quenched_sparks: 'wand',
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
 * Skin types the player may apply right now, in RESOLUTION ORDER (the first
 * entry present in the loadout is the one displayed). Requires an equipped
 * weapon in at least one hand: the mainhand's type comes first, then the
 * offhand's when a dual-wielder holds a DIFFERENT weapon type there (a rogue
 * with a dagger mainhand and a mace offhand may apply a mace skin, which then
 * shows on the offhand alone; see mainhandShowsWeaponSkin). Reported from live
 * play: the rules once read the mainhand only, so an offhand-held mace could
 * never take the mace skin the account owned.
 *
 * Which types apply depends on the BODY, not just the class, because the body
 * decides what the hand actually shows. The hunter rig displays a fixed ranged
 * attach and never the equipped item (`player_hunter` carries no `weaponSlots`,
 * so only a bow/crossbow skin can replace it), which is why hunters take the
 * ranged types rather than their weapon's. The Combat Mech is a separate body
 * that DOES swap in the equipped mainhand, so a mech hunter can additionally
 * skin the weapon they are really holding.
 *
 * Ranged stays first for a mech hunter: it preserves the look a hunter already
 * had before putting the suit on, and a player who prefers the weapon skin
 * clears the ranged one (`Sim.setWeaponSkin(pid, null, type)`), so nothing is
 * locked out either way.
 */
export function skinnableWeaponTypesFor(
  cls: string,
  mainhandItemId: string | null | undefined,
  skinCatalog: SkinCatalog,
  offhandItemId: string | null | undefined = null,
): WeaponSkinType[] {
  // Empty hands apply nothing. A bare mainhand beside an offhand WEAPON still
  // counts (a rogue who unequipped the dagger keeps the mace); a shield or held
  // offhand alone does not. The hunter arm keeps its exact old answer: it
  // needs a mainhand (hunters never dual-wield, so the offhand is never a
  // weapon there anyway).
  if (!mainhandItemId && (cls === 'hunter' || !weaponTypeForItem(offhandItemId))) return [];
  const item = heldWeaponSkinTypes(mainhandItemId, offhandItemId);
  // Crossbow before bow: they share the one ranged display slot, so with both
  // in the loadout the crossbow skin wins resolution deterministically.
  if (cls !== 'hunter') return item;
  return skinCatalog === 'mech' ? ['crossbow', 'bow', ...item] : ['crossbow', 'bow'];
}

/** The skinnable weapon types actually held, mainhand first, offhand second,
 *  deduplicated (two daggers count once). Polearms and non-weapons contribute
 *  nothing. Pure and host-agnostic. */
function heldWeaponSkinTypes(
  mainhandItemId: string | null | undefined,
  offhandItemId: string | null | undefined,
): WeaponSkinType[] {
  const out: WeaponSkinType[] = [];
  for (const id of [mainhandItemId, offhandItemId]) {
    const held = weaponTypeForItem(id);
    if (!held || held === 'polearm' || out.includes(held)) continue;
    out.push(held);
  }
  return out;
}

/**
 * The skin the player's held weapons should show right now: the first loadout
 * entry whose weapon type is applicable to the equipped hands (and whose skin
 * still targets that type), or null. Pure; both hosts and the renderer
 * preview rely on this exact resolution. One skin id rides the wire; each hand
 * then shows it only when its own weapon type matches (mainhandShowsWeaponSkin
 * and offhandMirrorsWeaponSkin).
 */
export function resolveActiveWeaponSkin(
  cls: string,
  mainhandItemId: string | null | undefined,
  loadout: WeaponSkinLoadout | null | undefined,
  skinCatalog: SkinCatalog,
  offhandItemId: string | null | undefined = null,
): string | null {
  if (!loadout) return null;
  for (const t of skinnableWeaponTypesFor(cls, mainhandItemId, skinCatalog, offhandItemId)) {
    const skinId = loadout[t];
    if (skinId && WEAPON_SKINS[skinId]?.weaponType === t) return skinId;
  }
  return null;
}

/** The held-hands view resolveActiveWeaponSkin reads off a player entity (the
 *  Sim entity and the ClientWorld mirror both carry exactly these fields). */
export interface WeaponSkinBearer {
  templateId: string;
  mainhandItemId: string | null;
  offhandItemId: string | null;
  weaponSkinLoadout: WeaponSkinLoadout;
  /** Absent on a ClientWorld mirror entity that has not received `cat`: class body. */
  skinCatalog?: SkinCatalog;
}

/** resolveActiveWeaponSkin over a player entity's own fields. For player
 *  entities templateId is the class id (createPlayer). */
export function resolveEntityWeaponSkin(e: WeaponSkinBearer): string | null {
  return resolveActiveWeaponSkin(
    e.templateId,
    e.mainhandItemId,
    e.weaponSkinLoadout,
    e.skinCatalog ?? 'class',
    e.offhandItemId,
  );
}

/**
 * True when the active weapon skin renders on the MAINHAND: a ranged skin
 * always does (it replaces the hunter rig's fixed ranged attach, or takes the
 * Combat Mech's swap slot, whatever the hand holds), a melee skin only while
 * the mainhand holds a weapon of the skin's type. A dagger mainhand beside a
 * skinned offhand mace keeps its own dagger model. Mirror of
 * offhandMirrorsWeaponSkin for the other hand; pure and cosmetic-only.
 */
export function mainhandShowsWeaponSkin(
  skinId: string | null | undefined,
  mainhandItemId: string | null | undefined,
): boolean {
  const def = skinId ? WEAPON_SKINS[skinId] : null;
  if (!def) return false;
  if (def.weaponType === 'bow' || def.weaponType === 'crossbow') return true;
  return weaponTypeForItem(mainhandItemId) === def.weaponType;
}

/**
 * True when the active weapon skin should also render on the offhand: the
 * offhand holds a WEAPON whose type matches the skin's weaponType (a rogue
 * with two daggers and a dagger skin shows both blades skinned). Shields
 * (armor, no weapon type), held offhands (orbs/tomes, no weapon type), and any
 * offhand weapon of a DIFFERENT type resolve to a non-matching weapon type and
 * are excluded, so the equality check is the whole rule. Hand is deliberately
 * NOT consulted: a Fury warrior (equipment_rules.canDualWieldTwoHand) can
 * offhand a two-hander, and the mainhand rule already skins a matching-type
 * two-hander, so the mirror treats both hands the same. Pure and
 * account-cosmetic-only; the offhand keeps its own equipped item id on the wire
 * and the mirror is derived locally from that id plus the resolved skin.
 */
export function offhandMirrorsWeaponSkin(
  skinId: string | null | undefined,
  offhandItemId: string | null | undefined,
): boolean {
  const def = skinId ? WEAPON_SKINS[skinId] : null;
  if (!def) return false;
  return weaponTypeForItem(offhandItemId) === def.weaponType;
}

/** True when `skinType` may be applied with the given class, held items and
 *  displayed body. */
export function weaponSkinTypeMatches(
  cls: string,
  mainhandItemId: string | null | undefined,
  skinType: WeaponSkinType,
  skinCatalog: SkinCatalog,
  offhandItemId: string | null | undefined = null,
): boolean {
  return skinnableWeaponTypesFor(cls, mainhandItemId, skinCatalog, offhandItemId).includes(
    skinType,
  );
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
 * eligibility chips). Bow and crossbow are hunter-only: they replace the
 * hunter rig's fixed ranged attach, which no other class has. Every other type
 * derives from the item data: a class is eligible when it can equip a
 * proficiency-locked weapon of the type (starter weapons carry no class lock
 * and would mark every type all-class, so locked rows decide; a type with no
 * locked rows falls back to the full equip check).
 *
 * Hunters are NOT excluded from the melee types. They were, back when no body
 * could show a hunter's equipped weapon, but the Combat Mech does, so a hunter
 * holding a sword in the suit really can apply a sword skin and the chip would
 * be lying. The item data already answers this per type, so no hunter carve-out
 * is needed: hunters appear for exactly the types they can equip. Whether the
 * skin applies to the body they are wearing RIGHT NOW is the separate
 * `canApplyNow` question (`skinnableWeaponTypesFor`). Memoized: static content.
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
    out = CLASS_ORDER.filter((cls) => pool.some((item) => canEquipItem(cls, item)));
  }
  eligibleByType.set(type, out);
  return out;
}
