import type { PlayerClass } from '../../sim/types';
import type { WeaponLayoutOverride } from './manifest';
import { isMechVisualKey, mechHeldWeaponOverride, mechVisualKeyFor } from './manifest';

/** A character's real, in-world appearance for the char-select / char-sheet
 *  turntable: body class, appearance skin, whether it is the class rig or the
 *  class-agnostic Combat Mech cosmetic, and the equipped mainhand (null when
 *  unarmed, so the preview shows no weapon rather than a class default). */
export interface PreviewAppearance {
  cls: PlayerClass;
  skin: number;
  skinCatalog: 'class' | 'mech' | 'armored';
  mainhandItemId: string | null;
  /** The active Armory weapon-skin cosmetic, or null/absent for none. */
  weaponSkinId?: string | null;
  /** Optional for older character-summary callers; absent renders no offhand. */
  offhandItemId?: string | null;
  /** Cosmetic head look (defaults: face 0, hairStyle 0, beard off, model colours). */
  face?: number;
  hairStyle?: number;
  beard?: boolean;
  hairColor?: number;
  faceColor?: number;
}

export const DEFAULT_HEAD_APPEARANCE: Readonly<{
  face: number;
  hairStyle: number;
  beard: boolean;
}> = Object.freeze({
  face: 0,
  hairStyle: 0,
  beard: false,
});

/** Per-class starting head look for the character creator, so the class roster
 *  reads with variety instead of every class sharing hairStyle 0. Any field left
 *  out falls back to DEFAULT_HEAD_APPEARANCE, and the player can still pick any
 *  option in the head picker. Indices map to the picker buttons (button N shows
 *  index N-1). face: 0 = male (button 1), 1 = female (button 2). hairStyle (for
 *  the male face): 0 = Hair_04, 1 = Hair_01, 2 = Hair_02, 3 = Hair_03, 4 = bald.
 *  (see V02_HEAD_COSMETICS in manifest.ts.) */
export const CLASS_DEFAULT_HEAD: Readonly<
  Partial<Record<PlayerClass, Readonly<{ face?: number; hairStyle?: number; beard?: boolean }>>>
> = Object.freeze({
  rogue: { face: 1 },
  druid: { face: 1 },
  priest: { face: 1 },
  paladin: { hairStyle: 2 },
  warrior: { hairStyle: 3, beard: true },
  hunter: { hairStyle: 2 },
  mage: { hairStyle: 3 },
});

/** The character creator's starting head look for a class: the per-class default
 *  merged over the global default. */
export function defaultHeadFor(cls: PlayerClass): {
  face: number;
  hairStyle: number;
  beard: boolean;
} {
  return { ...DEFAULT_HEAD_APPEARANCE, ...(CLASS_DEFAULT_HEAD[cls] ?? {}) };
}

/** The body model key for a class in a given cosmetic catalog. The level-20
 *  'armored' look is a separate per-class body (like the Mech), so it resolves
 *  to its own key; every other catalog uses the plain class body. Shared by the
 *  preview and the appearance resolver so they can never disagree. */
export function classVisualKey(cls: PlayerClass, catalog: 'class' | 'mech' | 'armored'): string {
  if (catalog === 'mech') return mechVisualKeyFor(cls);
  return catalog === 'armored' ? `player_${cls}_armored` : `player_${cls}`;
}

/** The cosmetic catalog a body model key came from: the inverse of
 *  `classVisualKey`. Callers that only have a key (the HUD mounts the character
 *  preview by key) need this to rebuild a PreviewAppearance without flattening
 *  every non-mech key to 'class', which silently rendered the base body in place
 *  of the level-20 armored one. */
export function catalogForVisualKey(key: string): 'class' | 'mech' | 'armored' {
  if (isMechVisualKey(key)) return 'mech';
  return key.endsWith('_armored') ? 'armored' : 'class';
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
  const visualKey = classVisualKey(a.cls, a.skinCatalog);
  return {
    visualKey,
    weaponItemId: a.mainhandItemId ?? null,
    offhandItemId: a.offhandItemId ?? null,
    // Only the legacy shared mech body needs the wearer-class hand layout; a
    // per-class suit spreads its base class def and already holds weapons right.
    weaponOverride: visualKey === 'player_mech' ? mechHeldWeaponOverride(a.cls) : null,
  };
}

/** Stable identity of an appearance, so an async mech re-apply can bail out if a
 *  newer selection superseded it. */
export function appearanceSignature(a: PreviewAppearance): string {
  // weaponSkinId is part of the identity: without it, applying or removing an
  // Armory skin while a preview is mounted elides as "same appearance" and the
  // stale weapon model survives the repaint.
  return `${a.cls}|${a.skin}|${a.skinCatalog}|${a.mainhandItemId ?? ''}|${a.offhandItemId ?? ''}|${a.weaponSkinId ?? ''}|${a.face ?? 0}|${a.hairStyle ?? 0}|${a.beard ?? false}|${a.hairColor ?? ''}|${a.faceColor ?? ''}`;
}
