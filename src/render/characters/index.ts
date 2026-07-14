// Character visual system — rigged glTF replacements for the old procedural
// rigs. Asset fetches start at module import (see assets.ts) and register
// with the preload gate, so createCharacterVisual is synchronous by the time
// the Renderer constructs views.
import type { Entity, PlayerClass } from '../../sim/types';
import { mechHeldWeaponOverride, visualKeyFor } from './manifest';
import { CharacterVisual } from './visual';

export { CharacterPreview } from './preview';
export type { PreviewAppearance } from './preview_appearance';
export type { AnimState } from './visual';
export { CharacterVisual, setWeaponVfxViewportHeight } from './visual';

/** Build the visual for an entity (or an explicit shapeshift/polymorph form key). */
export function createCharacterVisual(
  e: Entity,
  formKey?: 'form_sheep' | 'form_bear' | 'form_cat' | 'form_travel',
): CharacterVisual {
  // forms (sheep/bear/cat/travel) are their own models — skins and held weapons
  // only apply to the base body
  const key = formKey ?? visualKeyFor(e);
  // The class-agnostic Combat Mech adopts the wearer class's hand layout, so a
  // rogue-skinned mech dual-wields the equipped weapon in both hands. e.templateId
  // is the player's class on every host, so this matches offline and online.
  const weaponOverride =
    !formKey && key === 'player_mech' && e.kind === 'player'
      ? mechHeldWeaponOverride(e.templateId as PlayerClass)
      : null;
  return new CharacterVisual(
    key,
    e.color,
    formKey ? 0 : (e.skin ?? 0),
    formKey ? null : e.mainhandItemId,
    weaponOverride,
  );
}
