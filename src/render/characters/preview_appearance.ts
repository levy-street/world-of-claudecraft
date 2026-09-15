import {
  mainhandShowsWeaponSkin,
  offhandMirrorsWeaponSkin,
} from '../../sim/content/weapon_skin_rules';
import { WEAPON_SKINS } from '../../sim/content/weapon_skins';
import type { PlayerClass, WeaponSkinType } from '../../sim/types';
import type { WeaponLayoutOverride } from './manifest';
import { mechHeldWeaponOverride } from './manifest';

/** A character's real, in-world appearance for the char-select / char-sheet
 *  turntable: body class, appearance skin, whether it is the class rig or the
 *  class-agnostic Combat Mech cosmetic, and the equipped mainhand (null when
 *  unarmed, so the preview shows no weapon rather than a class default). */
export interface PreviewAppearance {
  cls: PlayerClass;
  skin: number;
  skinCatalog: 'class' | 'mech';
  mainhandItemId: string | null;
  /** The active Armory weapon-skin cosmetic, or null/absent for none. */
  weaponSkinId?: string | null;
  /** Optional for older character-summary callers; absent renders no offhand. */
  offhandItemId?: string | null;
}

/** The model key + held-weapon layout the appearance resolves to. */
export interface PreviewVisual {
  visualKey: string;
  weaponItemId: string | null;
  offhandItemId: string | null;
  weaponOverride: WeaponLayoutOverride | null;
}

/** Resolve an appearance to its concrete visual, mirroring createCharacterVisual
 *  (index.ts): the Mech is a separate body (`player_mech`) that adopts the wearer
 *  class's hand layout (a rogue mech dual-wields), while the class rig uses
 *  `player_<class>` with no override. Kept DOM/Three-free so it is unit-tested. */
export function previewAppearanceVisual(a: PreviewAppearance): PreviewVisual {
  const mech = a.skinCatalog === 'mech';
  return {
    visualKey: mech ? 'player_mech' : `player_${a.cls}`,
    weaponItemId: a.mainhandItemId ?? null,
    offhandItemId: a.offhandItemId ?? null,
    weaponOverride: mech ? mechHeldWeaponOverride(a.cls) : null,
  };
}

/** The mainhand item the Armory inspect turntable should hold while trying on
 *  `skinId`: the real mainhand when either hand already shows that skin (the
 *  offhand mirror covers a mace held in the offhand), otherwise a stand-in
 *  item of the skin's own type so the try-on still dresses the mainhand, the
 *  way it always did before the mainhand type gate (mainhandShowsWeaponSkin).
 *  The stand-in is the first catalog item of that type, so it is stable. Pure. */
export function previewTryOnMainhand(
  skinId: string | null,
  mainhandItemId: string | null | undefined,
  offhandItemId: string | null | undefined,
): string | null {
  const mainhand = mainhandItemId ?? null;
  const def = skinId ? WEAPON_SKINS[skinId] : null;
  if (!def) return mainhand;
  if (mainhandShowsWeaponSkin(skinId, mainhand) || offhandMirrorsWeaponSkin(skinId, offhandItemId))
    return mainhand;
  return TRY_ON_STAND_IN[def.weaponType] ?? mainhand;
}

/** The named stand-in item per melee skin type (each a starter weapon that
 *  classifies to that type in WEAPON_TYPE_BY_ITEM, pinned by test), so the
 *  try-on never depends on the data table's declaration order. Ranged skins
 *  never need one (they dress the mainhand attach whatever it holds). */
export const TRY_ON_STAND_IN: Partial<Record<WeaponSkinType, string>> = {
  sword: 'worn_sword',
  axe: 'rusty_hatchet',
  mace: 'training_mace',
  dagger: 'rusty_dagger',
  staff: 'gnarled_staff',
  wand: 'palecoil_rod',
};

/** Stable identity of an appearance, so an async mech re-apply can bail out if a
 *  newer selection superseded it. */
export function appearanceSignature(a: PreviewAppearance): string {
  // weaponSkinId is part of the identity: without it, applying or removing an
  // Armory skin while a preview is mounted elides as "same appearance" and the
  // stale weapon model survives the repaint.
  return `${a.cls}|${a.skin}|${a.skinCatalog}|${a.mainhandItemId ?? ''}|${a.offhandItemId ?? ''}|${a.weaponSkinId ?? ''}`;
}
