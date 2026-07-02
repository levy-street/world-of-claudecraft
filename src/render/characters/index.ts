// Character visual system — rigged glTF replacements for the old procedural
// rigs. Asset fetches start at module import (see assets.ts) and register
// with the preload gate, so createCharacterVisual is synchronous by the time
// the Renderer constructs views.
import { RACES } from '../../sim/content/races';
import type { Entity, PlayerClass } from '../../sim/types';
import { mechHeldWeaponOverride, visualKeyFor } from './manifest';
import { CharacterVisual } from './visual';

// The per-race cosmetic color cast (RaceDef.tint): a subtle lerp toward the
// race's tone so the twelve races read differently on the shared class models.
// Cosmetic only, and skipped for shapeshift forms and cosmetic bodies (the
// mech keeps its chroma).
export const RACE_TINT_STRENGTH = 0.22;

export function raceTintFor(e: Entity, key: string): { color: number; strength: number } | null {
  if (e.kind !== 'player' || !e.race || key === 'player_mech') return null;
  return { color: RACES[e.race].tint, strength: RACE_TINT_STRENGTH };
}

export { CharacterPreview } from './preview';
export type { AnimState } from './visual';
export { CharacterVisual } from './visual';

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
    formKey ? null : raceTintFor(e, key),
  );
}
