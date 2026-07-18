import type { PlayerClass } from '../../sim/types';
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

/** Stable identity of an appearance, so an async mech re-apply can bail out if a
 *  newer selection superseded it. */
export function appearanceSignature(a: PreviewAppearance): string {
  return `${a.cls}|${a.skin}|${a.skinCatalog}|${a.mainhandItemId ?? ''}|${a.offhandItemId ?? ''}`;
}
